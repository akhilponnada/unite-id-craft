import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import AppNav from "@/components/AppNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Download, Loader2, Plus, Save, Trash2, Upload, Image as ImageIcon, Copy, Gift, Wallet, FileDown, FileUp, Sparkles } from "lucide-react";
import {
  BoqLine,
  BUILTIN_RESIDENTIAL_COVERS,
  DEFAULT_RESIDENTIAL_TERMS,
  blankBoqLine,
  computeResidential,
  inr,
  recomputeBoqAmounts,
  computeFinance,
  computeResidentialSubsidy,
  scaleBoq,
  PROPOSAL_CATEGORIES,
} from "@/lib/residential-presets";
import ResidentialDocument from "@/components/proposals/ResidentialDocument";
import DuplicateToSizesDialog from "@/components/proposals/DuplicateToSizesDialog";
import { exportProposalPdf } from "@/lib/proposal-export";
import { INDIAN_STATES, INDIA_CITY_SOLAR, citiesByState, lookupCity, DEFAULT_KWH_PER_KW_PER_DAY } from "@/lib/india-solar";

type Row = {
  id: string;
  title: string;
  proposal_number: string | null;
  is_customised: boolean;
  preset_id: string | null;
  category: string;
  client_name: string | null;
  client_location: string | null;
  client_contact: string | null;
  client_email: string | null;
  capacity_kw: number | null;
  panel_wattage: number | null;
  panel_count: number | null;
  inverter_capacity: number | null;
  structure_type: string | null;
  cost_per_kw: number | null;
  boq: BoqLine[];
  terms_and_conditions: string | null;
  cover_image_url: string | null;
  cover_source: string | null;
  // subsidy
  subsidy_amount: number;
  subsidy_per_kw: number;
  // offer
  offer_id: string | null;
  offer_discount: number;
  offer_label: string | null;
  // payment
  payment_mode: "cash" | "loan";
  loan_interest_rate: number;
  loan_tenure_years: number;
  subsidy_in_loan: boolean;
  monthly_savings_per_kw: number;
  // new
  bill_summary: any;
  warranties: string | null;
  service_amc: string | null;
  location_city: string | null;
  location_state: string | null;
  daily_generation_kwh_per_kw: number | null;
};

type Offer = {
  id: string;
  name: string;
  description: string | null;
  min_kw: number;
  max_kw: number;
  discount_amount: number;
  freebie_label: string | null;
  flyer_image_url: string | null;
  active: boolean;
};

const ResidentialProposalEditor: React.FC = () => {
  const { id } = useParams();
  const [params] = useSearchParams();
  const presetKw = params.get("kw");
  const nav = useNavigate();
  const { user } = useAuth();

  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupBusy, setDupBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const billInputRef = useRef<HTMLInputElement>(null);
  const [billBusy, setBillBusy] = useState(false);
  const [billInfo, setBillInfo] = useState<{ units: number; tariff: number; bill: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    (id !== "new" ? load(id!) : bootstrapNew());
    loadOffers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  const loadOffers = async () => {
    const { data } = await supabase.from("residential_offers").select("*").eq("active", true).order("name");
    setOffers((data ?? []) as Offer[]);
  };

  const load = async (rid: string) => {
    setLoading(true);
    const { data, error } = await supabase.from("residential_proposals").select("*").eq("id", rid).maybeSingle();
    setLoading(false);
    if (error || !data) { toast.error(error?.message || "Not found"); nav("/proposals"); return; }
    setRow({ ...(data as any), boq: ((data as any).boq || []) as BoqLine[] });
  };

  const bootstrapNew = async () => {
    if (!user) return;
    setLoading(true);
    let preset: any = null;
    const isCustom = !presetKw || presetKw === "custom";
    if (!isCustom) {
      const { data } = await supabase.from("residential_presets").select("*").eq("capacity_kw", Number(presetKw)).maybeSingle();
      preset = data;
    }
    // Pull global defaults (warranties / AMC / general terms) from admin settings.
    const { data: settings } = await supabase
      .from("proposal_settings")
      .select("warranties, service_amc, general_terms")
      .limit(1)
      .maybeSingle();
    const cap = preset?.capacity_kw ?? (isCustom ? 5 : Number(presetKw));
    const insert = {
      user_id: user.id,
      title: isCustom ? "Custom Residential Proposal" : `${presetKw} kW Residential Solar Proposal`,
      is_customised: isCustom,
      preset_id: preset?.id || null,
      category: preset?.category || "Residential",
      capacity_kw: cap,
      panel_wattage: preset?.panel_wattage ?? 550,
      panel_count: preset?.panel_count ?? 0,
      inverter_capacity: preset?.inverter_capacity ?? cap,
      structure_type: preset?.structure_type ?? "GI elevated rooftop structure",
      cost_per_kw: preset?.cost_per_kw ?? 55000,
      boq: preset?.boq ?? [],
      terms_and_conditions: settings?.general_terms || preset?.terms_and_conditions || DEFAULT_RESIDENTIAL_TERMS,
      warranties: settings?.warranties || null,
      service_amc: settings?.service_amc || null,
      subsidy_amount: preset?.subsidy_amount ?? computeResidentialSubsidy(cap),
      subsidy_per_kw: preset?.subsidy_per_kw ?? 0,
      daily_generation_kwh_per_kw: DEFAULT_KWH_PER_KW_PER_DAY,
    };
    const { data: created, error } = await supabase.from("residential_proposals").insert(insert).select("*").single();
    setLoading(false);
    if (error) { toast.error(error.message); nav("/proposals"); return; }
    nav(`/proposals/residential/${created.id}`, { replace: true });
  };

  const computed = useMemo(() => {
    if (!row) return computeResidential([], 0);
    return computeResidential(row.boq || [], Number(row.capacity_kw) || 0);
  }, [row]);

  const finance = useMemo(() => {
    if (!row) return null;
    const subsidyTotal = (row.subsidy_amount || 0) + (row.subsidy_per_kw || 0) * (row.capacity_kw || 0);
    return computeFinance({
      totalCost: computed.totalCost,
      subsidy: subsidyTotal,
      offerDiscount: row.offer_discount || 0,
      capacityKw: row.capacity_kw || 0,
      monthlySavingsPerKw: row.monthly_savings_per_kw || 1000,
      loanInterestRate: row.loan_interest_rate || 0,
      loanTenureYears: row.loan_tenure_years || 0,
    });
  }, [row, computed]);

  const update = (patch: Partial<Row>) => setRow((r) => (r ? { ...r, ...patch } : r));
  const updateBoqLine = (i: number, patch: Partial<BoqLine>) => {
    if (!row) return;
    const next = [...row.boq];
    next[i] = { ...next[i], ...patch };
    update({ boq: recomputeBoqAmounts(next) });
  };
  const addBoqLine = () => row && update({ boq: [...row.boq, blankBoqLine()] });
  const removeBoqLine = (i: number) => row && update({ boq: row.boq.filter((_, idx) => idx !== i) });

  // Auto-recompute residential subsidy when category=Residential and capacity changes
  const onCapacityChange = (kw: number) => {
    if (!row) return;
    if (row.category === "Residential") {
      update({ capacity_kw: kw, subsidy_amount: computeResidentialSubsidy(kw) });
    } else {
      update({ capacity_kw: kw });
    }
  };

  const onCategoryChange = (cat: string) => {
    if (!row) return;
    if (cat === "Residential") {
      update({ category: cat, subsidy_amount: computeResidentialSubsidy(row.capacity_kw || 0), subsidy_per_kw: 0 });
    } else {
      update({ category: cat });
    }
  };

  const applyOffer = (offerId: string) => {
    if (!row) return;
    if (offerId === "none") {
      update({ offer_id: null, offer_discount: 0, offer_label: null });
      return;
    }
    const o = offers.find(x => x.id === offerId);
    if (!o) return;
    const cap = row.capacity_kw || 0;
    if (cap < o.min_kw || cap > o.max_kw) {
      toast.error(`Offer applies only to ${o.min_kw}–${o.max_kw} kW systems`);
      return;
    }
    update({ offer_id: o.id, offer_discount: o.discount_amount || 0, offer_label: o.freebie_label || o.name });
    toast.success(`Offer applied: ${o.name}`);
  };

  const eligibleOffers = useMemo(() => {
    if (!row) return [];
    const cap = row.capacity_kw || 0;
    return offers.filter(o => cap >= o.min_kw && cap <= o.max_kw);
  }, [offers, row]);

  const selectedOffer = useMemo(() => offers.find(o => o.id === row?.offer_id) || null, [offers, row?.offer_id]);

  const save = async () => {
    if (!row) return;
    setSaving(true);
    const { error } = await supabase.from("residential_proposals").update({
      title: row.title,
      proposal_number: row.proposal_number,
      category: row.category,
      client_name: row.client_name,
      client_location: row.client_location,
      client_contact: row.client_contact,
      client_email: row.client_email,
      capacity_kw: row.capacity_kw,
      panel_wattage: row.panel_wattage,
      panel_count: row.panel_count,
      inverter_capacity: row.inverter_capacity,
      structure_type: row.structure_type,
      cost_per_kw: row.cost_per_kw,
      boq: row.boq as any,
      terms_and_conditions: row.terms_and_conditions,
      cover_image_url: row.cover_image_url,
      cover_source: row.cover_source,
      subsidy_amount: row.subsidy_amount,
      subsidy_per_kw: row.subsidy_per_kw,
      offer_id: row.offer_id,
      offer_discount: row.offer_discount,
      offer_label: row.offer_label,
      payment_mode: row.payment_mode,
      loan_interest_rate: row.loan_interest_rate,
      loan_tenure_years: row.loan_tenure_years,
      subsidy_in_loan: row.subsidy_in_loan,
      monthly_savings_per_kw: row.monthly_savings_per_kw,
      bill_summary: row.bill_summary || {},
      warranties: row.warranties,
      service_amc: row.service_amc,
      location_city: row.location_city,
      location_state: row.location_state,
      daily_generation_kwh_per_kw: row.daily_generation_kwh_per_kw,
      computed: { ...computed, finance } as any,
    }).eq("id", row.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  };

  const onPickCover = (url: string, source: string) => update({ cover_image_url: url, cover_source: source });

  const onUploadCover = async (file: File) => {
    if (!user || !row) return;
    const path = `${user.id}/residential-covers/${row.id}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("proposals").upload(path, file, { upsert: true, contentType: file.type });
    if (error) return toast.error(error.message);
    const { data: pub } = supabase.storage.from("proposals").getPublicUrl(path);
    onPickCover(pub.publicUrl, "upload");
    toast.success("Cover uploaded");
  };

  const exportPdf = async () => {
    if (!row) return;
    setExporting(true);
    try {
      const fname = `${(row.title || "Residential-Proposal").replace(/\s+/g, "_")}.pdf`;
      await exportProposalPdf(fname);
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const downloadFlyer = () => {
    if (!selectedOffer?.flyer_image_url) {
      toast.error("No flyer available for this offer");
      return;
    }
    const a = document.createElement("a");
    a.href = selectedOffer.flyer_image_url;
    a.download = `${selectedOffer.name.replace(/\s+/g, "_")}_flyer`;
    a.target = "_blank";
    a.click();
  };

  // Power bill upload → AI extraction → fill monthly_savings_per_kw
  const onUploadBill = async (file: File) => {
    if (!row) return;
    setBillBusy(true);
    try {
      const fileBase64: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(",")[1] || "");
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke("extract-power-bill", {
        body: { fileBase64, mimeType: file.type || "application/octet-stream" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const units = Number((data as any).monthly_units) || 0;
      const bill = Number((data as any).monthly_bill) || 0;
      let tariff = Number((data as any).energy_charge_per_unit) || 0;
      if (!tariff && units > 0 && bill > 0) tariff = +(bill / units).toFixed(2);
      const cap = Number(row.capacity_kw) || 1;
      // Savings per kW = (units × tariff) ÷ kW  (caps at the customer's actual bill)
      const totalSavings = units * tariff;
      const perKw = cap > 0 ? Math.round(totalSavings / cap) : 0;
      setBillInfo({ units, tariff, bill });
      // Persist the parsed bill on the proposal so it shows on the PDF cover.
      const summary = {
        consumer_name: (data as any).consumer_name || "",
        state: (data as any).state || "",
        billing_month: (data as any).billing_month || "",
        monthly_units: units,
        monthly_bill: bill,
        energy_charge_per_unit: tariff,
        sanction_load_kw: Number((data as any).sanction_load_kw) || 0,
      };
      update({ bill_summary: summary });
      if (perKw > 0) {
        update({ monthly_savings_per_kw: perKw });
        toast.success(`Bill parsed: ${units} units @ ₹${tariff}/u → ₹${perKw}/kW/mo`);
      } else {
        toast.warning("Couldn't compute savings — check the extracted values.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to parse bill");
    } finally {
      setBillBusy(false);
    }
  };

  // Duplicate current BOQ to N new proposals at other sizes
  const duplicateToSizes = async (sizes: number[]): Promise<void> => {
    if (!row || !user) return;
    setDupBusy(true);
    const baseKw = row.capacity_kw || 0;
    const inserts = sizes.map((kw) => {
      const scaled = recomputeBoqAmounts(scaleBoq(row.boq, baseKw, kw));
      return {
        user_id: user.id,
        title: `${kw} kW ${row.category} Solar Proposal`,
        is_customised: row.is_customised,
        preset_id: null,
        category: row.category,
        capacity_kw: kw,
        panel_wattage: row.panel_wattage,
        panel_count: row.panel_count ? Math.ceil((row.panel_count / Math.max(1, baseKw)) * kw) : 0,
        inverter_capacity: kw,
        structure_type: row.structure_type,
        cost_per_kw: row.cost_per_kw,
        boq: scaled as any,
        terms_and_conditions: row.terms_and_conditions,
        subsidy_amount: row.category === "Residential" ? computeResidentialSubsidy(kw) : row.subsidy_amount,
        subsidy_per_kw: row.subsidy_per_kw,
        monthly_savings_per_kw: row.monthly_savings_per_kw,
        cover_image_url: row.cover_image_url,
        cover_source: row.cover_source,
      };
    });
    const { error } = await supabase.from("residential_proposals").insert(inserts as any);
    setDupBusy(false);
    setDupOpen(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Created ${sizes.length} new proposal${sizes.length === 1 ? "" : "s"}`);
    nav("/proposals");
  };

  if (loading || !row) {
    return (
      <div className="min-h-screen bg-background">
        <AppNav />
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => nav("/proposals")}><ArrowLeft className="h-4 w-4" /> Back</Button>
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={() => setDupOpen(true)} disabled={!row.boq.length}>
              <Copy className="h-4 w-4" /> Duplicate to sizes
            </Button>
            <Button variant="outline" size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </Button>
            <Button size="sm" onClick={exportPdf} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export PDF
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
          {/* LEFT */}
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Proposal</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div><Label>Title</Label><Input value={row.title} onChange={(e) => update({ title: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Proposal #</Label><Input value={row.proposal_number || ""} onChange={(e) => update({ proposal_number: e.target.value })} placeholder="US-RES-001" /></div>
                  <div><Label>Capacity (kW)</Label><Input type="number" value={row.capacity_kw || 0} onChange={(e) => onCapacityChange(+e.target.value)} disabled={!row.is_customised} /></div>
                </div>
                <div>
                  <Label>Category</Label>
                  <Select value={row.category} onValueChange={onCategoryChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROPOSAL_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="client">
              <TabsList className="grid grid-cols-6 w-full text-[11px]">
                <TabsTrigger value="client">Client</TabsTrigger>
                <TabsTrigger value="system">System</TabsTrigger>
                <TabsTrigger value="boq">BOQ</TabsTrigger>
                <TabsTrigger value="finance">Finance</TabsTrigger>
                <TabsTrigger value="offers">Offers</TabsTrigger>
                <TabsTrigger value="cover">Cover</TabsTrigger>
              </TabsList>

              <TabsContent value="client" className="space-y-3 mt-3">
                <div><Label>Client name</Label><Input value={row.client_name || ""} onChange={(e) => update({ client_name: e.target.value })} /></div>
                <div><Label>Location</Label><Input value={row.client_location || ""} onChange={(e) => update({ client_location: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Contact</Label><Input value={row.client_contact || ""} onChange={(e) => update({ client_contact: e.target.value })} /></div>
                  <div><Label>Email</Label><Input value={row.client_email || ""} onChange={(e) => update({ client_email: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                  <div>
                    <Label className="text-xs">State (for solar generation)</Label>
                    <Select value={row.location_state || ""} onValueChange={(v) => update({ location_state: v, location_city: null, daily_generation_kwh_per_kw: DEFAULT_KWH_PER_KW_PER_DAY })}>
                      <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {INDIAN_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">City</Label>
                    <Select
                      value={row.location_city || ""}
                      onValueChange={(v) => {
                        const c = lookupCity(v);
                        update({ location_city: v, daily_generation_kwh_per_kw: c?.kWhPerKwPerDay ?? DEFAULT_KWH_PER_KW_PER_DAY });
                      }}
                      disabled={!row.location_state}
                    >
                      <SelectTrigger><SelectValue placeholder={row.location_state ? "Select city" : "Pick state first"} /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {(row.location_state ? citiesByState(row.location_state) : []).map(c => (
                          <SelectItem key={c.city} value={c.city}>{c.city} ({c.kWhPerKwPerDay} kWh/kW/day)</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {row.location_city && (
                  <p className="text-[11px] text-muted-foreground">
                    Estimated generation: <b>{((row.daily_generation_kwh_per_kw || 0) * (row.capacity_kw || 0)).toFixed(1)} kWh/day</b> ({Math.round((row.daily_generation_kwh_per_kw || 0) * (row.capacity_kw || 0) * 365).toLocaleString("en-IN")} kWh/year)
                  </p>
                )}
              </TabsContent>

              <TabsContent value="system" className="space-y-3 mt-3">
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Panel wattage (Wp)</Label><Input type="number" value={row.panel_wattage || 0} onChange={(e) => update({ panel_wattage: +e.target.value })} /></div>
                  <div><Label>Panel count</Label><Input type="number" value={row.panel_count || 0} onChange={(e) => update({ panel_count: +e.target.value })} /></div>
                  <div><Label>Inverter (kW)</Label><Input type="number" value={row.inverter_capacity || 0} onChange={(e) => update({ inverter_capacity: +e.target.value })} /></div>
                  <div><Label>Cost / kW (₹)</Label><Input type="number" value={row.cost_per_kw || 0} onChange={(e) => update({ cost_per_kw: +e.target.value })} /></div>
                </div>
                <div><Label>Structure</Label><Input value={row.structure_type || ""} onChange={(e) => update({ structure_type: e.target.value })} /></div>
                <div>
                  <Label>Terms & Conditions</Label>
                  <Textarea rows={8} value={row.terms_and_conditions || ""} onChange={(e) => update({ terms_and_conditions: e.target.value })} />
                </div>
                <div>
                  <Label>Warranties</Label>
                  <Textarea rows={6} value={row.warranties || ""} onChange={(e) => update({ warranties: e.target.value })} placeholder="Modules, inverter, structure, workmanship…" />
                </div>
                <div>
                  <Label>Service & AMC</Label>
                  <Textarea rows={6} value={row.service_amc || ""} onChange={(e) => update({ service_amc: e.target.value })} placeholder="AMC plans, visit frequency, response time…" />
                </div>
              </TabsContent>

              <TabsContent value="boq" className="space-y-2 mt-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">Tick "Fixed" for items that don't scale with kW.</div>
                  <Button size="sm" variant="outline" onClick={addBoqLine}><Plus className="h-3.5 w-3.5" /> Add</Button>
                </div>
                <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
                  {row.boq.map((l, i) => (
                    <div key={i} className="rounded border p-2 space-y-1">
                      <div className="flex gap-2 items-center">
                        <Input className="text-xs flex-1" value={l.item} onChange={(e) => updateBoqLine(i, { item: e.target.value })} placeholder="Item description" />
                        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Checkbox checked={!!l.is_fixed} onCheckedChange={(v) => updateBoqLine(i, { is_fixed: !!v })} />
                          Fixed
                        </label>
                        <Button size="icon" variant="ghost" onClick={() => removeBoqLine(i)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        <Input className="text-xs" type="number" value={l.qty} onChange={(e) => updateBoqLine(i, { qty: +e.target.value })} placeholder="Qty" />
                        <Input className="text-xs" value={l.unit} onChange={(e) => updateBoqLine(i, { unit: e.target.value })} placeholder="Unit" />
                        <Input className="text-xs" type="number" value={l.rate} onChange={(e) => updateBoqLine(i, { rate: +e.target.value })} placeholder="Rate" />
                        <div className="text-xs text-right self-center font-bold">{inr(l.amount)}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="rounded bg-muted p-3 text-xs space-y-1">
                  <div className="flex justify-between"><span>Subtotal</span><b>{inr(computed.boqSubtotal)}</b></div>
                  <div className="flex justify-between"><span>GST</span><b>{inr(computed.gstTotal)}</b></div>
                  <div className="flex justify-between text-sm"><span>Total</span><b className="text-primary">{inr(computed.totalCost)}</b></div>
                </div>
              </TabsContent>

              <TabsContent value="finance" className="space-y-3 mt-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs uppercase tracking-wide flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Power Bill (AI auto-fill)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      Upload the customer's electricity bill (PDF or image). We'll extract units & tariff and set savings per kW.
                    </p>
                    <input
                      ref={billInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      hidden
                      onChange={(e) => e.target.files?.[0] && onUploadBill(e.target.files[0])}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => billInputRef.current?.click()}
                      disabled={billBusy}
                    >
                      {billBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
                      {billBusy ? "Parsing bill…" : "Upload power bill"}
                    </Button>
                    {billInfo && (
                      <div className="rounded border p-2 bg-muted/40 text-[11px] space-y-0.5">
                        <div className="flex justify-between"><span>Monthly units</span><b>{billInfo.units}</b></div>
                        <div className="flex justify-between"><span>Tariff</span><b>₹{billInfo.tariff}/unit</b></div>
                        <div className="flex justify-between"><span>Bill amount</span><b>{inr(billInfo.bill)}</b></div>
                        <div className="flex justify-between border-t pt-1"><span>Savings / kW / month</span><b className="text-primary">{inr(row.monthly_savings_per_kw)}</b></div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide">Subsidy</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Subsidy (₹)</Label>
                        <Input type="number" value={row.subsidy_amount} onChange={(e) => update({ subsidy_amount: +e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs">Per-kW subsidy (₹)</Label>
                        <Input type="number" value={row.subsidy_per_kw} onChange={(e) => update({ subsidy_per_kw: +e.target.value })} disabled={row.category === "Residential"} />
                      </div>
                    </div>
                    {row.category === "Residential" && (
                      <p className="text-[11px] text-muted-foreground">Auto-set by Residential rule (1kW=₹30k, 2kW=₹60k, 3kW+=₹78k). Edit to override.</p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide flex items-center gap-1"><Wallet className="h-3 w-3"/> Payment Mode</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <Select value={row.payment_mode} onValueChange={(v: any) => update({ payment_mode: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="loan">Loan (100%)</SelectItem>
                      </SelectContent>
                    </Select>
                    {row.payment_mode === "loan" && (
                      <>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <div><Label className="text-xs">Interest Rate (% p.a.)</Label><Input type="number" step="0.1" value={row.loan_interest_rate} onChange={(e) => update({ loan_interest_rate: +e.target.value })} /></div>
                          <div><Label className="text-xs">Tenure (years)</Label><Input type="number" value={row.loan_tenure_years} onChange={(e) => update({ loan_tenure_years: +e.target.value })} /></div>
                        </div>
                        <label className="flex items-center gap-2 text-xs pt-1">
                          <Switch checked={row.subsidy_in_loan} onCheckedChange={(v) => update({ subsidy_in_loan: v })} />
                          Include subsidy in loan reduction
                        </label>
                      </>
                    )}
                    <div className="pt-2">
                      <Label className="text-xs">Monthly savings per kW (₹)</Label>
                      <Input type="number" value={row.monthly_savings_per_kw} onChange={(e) => update({ monthly_savings_per_kw: +e.target.value })} />
                    </div>
                  </CardContent>
                </Card>

                {finance && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide">Live calculation</CardTitle></CardHeader>
                    <CardContent className="text-xs space-y-1">
                      <div className="flex justify-between"><span>Total cost</span><b>{inr(finance.totalCost)}</b></div>
                      <div className="flex justify-between"><span>− Offer discount</span><b className="text-emerald-600">{inr(finance.offerDiscount)}</b></div>
                      <div className="flex justify-between"><span>− Subsidy</span><b className="text-emerald-600">{inr(finance.subsidy)}</b></div>
                      <div className="flex justify-between border-t pt-1"><span>Net cost</span><b className="text-primary">{inr(Math.max(0, finance.netCost - finance.subsidy))}</b></div>
                      <div className="flex justify-between pt-1"><span>Monthly savings</span><b className="text-emerald-600">{inr(finance.monthlySavings)}</b></div>
                      {row.payment_mode === "loan" && (
                        <>
                          <div className="flex justify-between pt-1"><span>EMI (full)</span><b>{inr(finance.emiFull)}</b></div>
                          <div className="flex justify-between"><span>EMI (after subsidy)</span><b>{inr(finance.emiAfterSubsidy)}</b></div>
                          <div className="flex justify-between"><span>Net impact (before)</span><b className={finance.netImpactBefore >= 0 ? "text-emerald-600" : "text-destructive"}>{inr(finance.netImpactBefore)}</b></div>
                          <div className="flex justify-between"><span>Net impact (after)</span><b className={finance.netImpactAfter >= 0 ? "text-emerald-600" : "text-destructive"}>{inr(finance.netImpactAfter)}</b></div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="offers" className="space-y-3 mt-3">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide flex items-center gap-1"><Gift className="h-3 w-3"/> Apply Offer</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <Select value={row.offer_id || "none"} onValueChange={applyOffer}>
                      <SelectTrigger><SelectValue placeholder="No offer" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No offer</SelectItem>
                        {eligibleOffers.map(o => (
                          <SelectItem key={o.id} value={o.id}>{o.name} {o.discount_amount > 0 ? `(− ${inr(o.discount_amount)})` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedOffer && (
                      <div className="rounded border p-3 bg-muted/40 text-xs space-y-2">
                        <div className="font-bold">{selectedOffer.name}</div>
                        {selectedOffer.description && <div>{selectedOffer.description}</div>}
                        {selectedOffer.freebie_label && <div className="text-primary">🎁 {selectedOffer.freebie_label}</div>}
                        {selectedOffer.discount_amount > 0 && <div>Discount: <b>{inr(selectedOffer.discount_amount)}</b></div>}
                        {selectedOffer.flyer_image_url && (
                          <div className="flex items-center gap-2 pt-1">
                            <img src={selectedOffer.flyer_image_url} alt="flyer" className="h-16 w-16 object-cover rounded" />
                            <Button size="sm" variant="outline" onClick={downloadFlyer}><FileDown className="h-3.5 w-3.5 mr-1" /> Download flyer</Button>
                          </div>
                        )}
                      </div>
                    )}
                    {eligibleOffers.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">No offers match current capacity ({row.capacity_kw} kW).</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="cover" className="space-y-3 mt-3">
                <div>
                  <Label className="text-xs">Built-in covers</Label>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {BUILTIN_RESIDENTIAL_COVERS.map((c) => (
                      <button key={c.id} onClick={() => onPickCover(c.url, `builtin:${c.id}`)} className={`relative rounded overflow-hidden border-2 transition ${row.cover_image_url === c.url ? "border-primary" : "border-transparent hover:border-muted-foreground/30"}`}>
                        <img src={c.url} alt={c.name} className="aspect-[210/297] object-cover w-full" loading="lazy" />
                        <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] p-1 text-center">{c.name}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Or upload your own (A4 portrait recommended)</Label>
                  <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onUploadCover(e.target.files[0])} />
                  <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-3.5 w-3.5" /> Upload cover image
                  </Button>
                </div>
                {row.cover_image_url && (
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => onPickCover("", "")}>
                    <ImageIcon className="h-3.5 w-3.5" /> Remove cover
                  </Button>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* RIGHT */}
          <div className="bg-muted/40 rounded-lg p-4 overflow-auto">
            <div style={{ transform: "scale(0.72)", transformOrigin: "top center" }}>
              <ResidentialDocument
                title={row.title}
                proposalNumber={row.proposal_number}
                client={{ name: row.client_name || "", location: row.client_location || "", contact: row.client_contact || "", email: row.client_email || "" }}
                capacityKw={Number(row.capacity_kw) || 0}
                panelCount={Number(row.panel_count) || 0}
                panelWattage={Number(row.panel_wattage) || 0}
                inverterCapacity={Number(row.inverter_capacity) || 0}
                structureType={row.structure_type || ""}
                boq={row.boq}
                terms={row.terms_and_conditions || DEFAULT_RESIDENTIAL_TERMS}
                computed={computed}
                coverUrl={row.cover_image_url || undefined}
                category={row.category}
                finance={finance || undefined}
                paymentMode={row.payment_mode}
                loanInterestRate={row.loan_interest_rate}
                loanTenureYears={row.loan_tenure_years}
                subsidyInLoan={row.subsidy_in_loan}
                offerLabel={row.offer_label}
                offerDescription={selectedOffer?.description || null}
                billSummary={row.bill_summary}
                warranties={row.warranties}
                serviceAmc={row.service_amc}
                locationCity={row.location_city}
                locationState={row.location_state}
                dailyGenerationKwhPerKw={row.daily_generation_kwh_per_kw}
              />
            </div>
          </div>
        </div>
      </main>

      <DuplicateToSizesDialog
        open={dupOpen}
        onOpenChange={setDupOpen}
        baseKw={row.capacity_kw || 0}
        busy={dupBusy}
        onConfirm={duplicateToSizes}
        title={`Duplicate this proposal to other sizes`}
        description={`Creates new proposals at the selected kW sizes with this BOQ scaled. Items marked Fixed are kept as-is; panels round up; cables get +10%.`}
      />
    </div>
  );
};

export default ResidentialProposalEditor;