import React, { useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import PageBanner, { BANNERS } from "@/components/PageBanner";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Key, ImagePlus, Trash2, ShieldCheck, Loader2, Palette, Plus, Users, UserPlus, UserMinus, Search, Mail, KeyRound, CheckCircle2, Clock } from "lucide-react";
import ResidentialPresetsManager from "@/components/admin/ResidentialPresetsManager";
import ResidentialOffersManager from "@/components/admin/ResidentialOffersManager";
import ProposalSettingsManager from "@/components/admin/ProposalSettingsManager";
import FixedSlidesManager from "@/components/admin/FixedSlidesManager";

interface BrandAsset { id: string; name: string; asset_type: string; image_url: string; storage_path: string | null; }
interface ApiKeyRow { provider: string; label: string | null; updated_at: string; }
interface BrandPalette { id: string; name: string; colors: string[]; }
interface ManagedUser { id: string; email: string; created_at: string; email_confirmed_at: string | null; roles: string[]; }

const AdminPage: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();

  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [savedKeys, setSavedKeys] = useState<ApiKeyRow[]>([]);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [uploadType, setUploadType] = useState<"logo" | "image">("logo");
  const [uploading, setUploading] = useState(false);

  const [palettes, setPalettes] = useState<BrandPalette[]>([]);
  const [newPaletteName, setNewPaletteName] = useState("");
  const [newPaletteColors, setNewPaletteColors] = useState("#f08c00, #3a3a3a, #1a3c6e");
  const [savingPalette, setSavingPalette] = useState(false);

  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [grantEmail, setGrantEmail] = useState("");
  const [granting, setGranting] = useState(false);
  const [adminCount, setAdminCount] = useState(0);
  const [maxAdmins, setMaxAdmins] = useState(20);
  const [actioningEmail, setActioningEmail] = useState<string | null>(null);

  // Search and pagination for user list
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userPage, setUserPage] = useState(1);
  const USERS_PER_PAGE = 20;

  // Self-claim admin if no admin exists yet (bootstrap)
  const [bootstrapping, setBootstrapping] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);

  useEffect(() => {
    const checkBootstrap = async () => {
      if (!user || isAdmin || roleLoading) return;
      const { count } = await supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin");
      setNeedsBootstrap((count ?? 0) === 0);
    };
    checkBootstrap();
  }, [user, isAdmin, roleLoading]);

  const claimAdmin = async () => {
    if (!user) return;
    setBootstrapping(true);
    const { error } = await supabase.from("user_roles").insert({ user_id: user.id, role: "admin" });
    setBootstrapping(false);
    if (error) { toast.error(error.message); return; }
    toast.success("You're now the admin. Reloading…");
    setTimeout(() => window.location.reload(), 800);
  };

  const loadAdminData = async () => {
    const [{ data: keys }, { data: brand }, { data: pals }] = await Promise.all([
      supabase.from("api_keys").select("provider,label,updated_at"),
      supabase.from("brand_assets").select("*").order("created_at", { ascending: false }),
      supabase.from("brand_palettes").select("id,name,colors").order("created_at", { ascending: true }),
    ]);
    setSavedKeys(keys ?? []);
    setAssets(brand ?? []);
    setPalettes((pals ?? []).map((p: any) => ({ ...p, colors: Array.isArray(p.colors) ? p.colors : [] })));
  };

  const loadUsers = async () => {
    setUsersLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-manage-roles", { body: { action: "list" } });
    setUsersLoading(false);
    if (error) { toast.error(error.message); return; }
    setManagedUsers(data?.users ?? []);
    setAdminCount(data?.adminCount ?? 0);
    setMaxAdmins(data?.maxAdmins ?? 20);
    setUserPage(1);
  };

  const grantAdmin = async () => {
    const email = grantEmail.trim().toLowerCase();
    if (!email) { toast.error("Enter an email"); return; }
    if (adminCount >= maxAdmins) { toast.error(`Admin limit reached (${maxAdmins}). Revoke an existing admin first.`); return; }
    setGranting(true);
    // Use "invite" action — creates user + sends verification/password setup email if new, else just grants admin.
    const { data, error } = await supabase.functions.invoke("admin-manage-roles", {
      body: { action: "invite", email, redirectTo: window.location.origin },
    });
    setGranting(false);
    if (error || data?.error) { toast.error(error?.message || data?.error); return; }
    toast.success(data?.message || `Admin granted to ${email}`);
    setGrantEmail("");
    loadUsers();
  };

  const revokeAdmin = async (email: string) => {
    if (!confirm(`Revoke admin from ${email}?`)) return;
    setActioningEmail(email);
    const { data, error } = await supabase.functions.invoke("admin-manage-roles", {
      body: { action: "revoke", email },
    });
    setActioningEmail(null);
    if (error || data?.error) { toast.error(error?.message || data?.error); return; }
    toast.success("Admin revoked");
    loadUsers();
  };

  const sendPasswordReset = async (email: string) => {
    setActioningEmail(email);
    const { data, error } = await supabase.functions.invoke("admin-manage-roles", {
      body: { action: "send_password_reset", email, redirectTo: `${window.location.origin}/reset-password` },
    });
    setActioningEmail(null);
    if (error || data?.error) { toast.error(error?.message || data?.error); return; }
    toast.success(data?.message || `Password reset email sent to ${email}`);
  };

  const resendVerification = async (email: string) => {
    setActioningEmail(email);
    const { data, error } = await supabase.functions.invoke("admin-manage-roles", {
      body: { action: "resend_verification", email, redirectTo: window.location.origin },
    });
    setActioningEmail(null);
    if (error || data?.error) { toast.error(error?.message || data?.error); return; }
    toast.success(data?.message || `Verification email sent to ${email}`);
  };

  useEffect(() => { if (isAdmin) { loadAdminData(); loadUsers(); } }, [isAdmin]);

  const saveKey = async (provider: "openai" | "gemini", apiKey: string, label: string) => {
    if (!apiKey.trim()) { toast.error("Paste an API key first"); return; }
    setSavingKey(provider);
    const { error } = await supabase.from("api_keys").upsert(
      { provider, api_key: apiKey.trim(), label, updated_by: user!.id },
      { onConflict: "provider" }
    );
    setSavingKey(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${label} key saved. Design team can use it now.`);
    if (provider === "openai") setOpenaiKey("");
    else setGeminiKey("");
    loadAdminData();
  };

  const deleteKey = async (provider: string) => {
    if (!confirm(`Remove ${provider} key?`)) return;
    const { error } = await supabase.from("api_keys").delete().eq("provider", provider);
    if (error) { toast.error(error.message); return; }
    toast.success("Key removed");
    loadAdminData();
  };

  const uploadAsset = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("brand-assets").upload(path, file);
    if (upErr) { toast.error(upErr.message); setUploading(false); return; }
    const { data: { publicUrl } } = supabase.storage.from("brand-assets").getPublicUrl(path);
    const { error: insErr } = await supabase.from("brand_assets").insert({
      name: file.name, asset_type: uploadType, image_url: publicUrl, storage_path: path, uploaded_by: user.id,
    });
    setUploading(false);
    e.target.value = "";
    if (insErr) { toast.error(insErr.message); return; }
    toast.success("Brand asset added to library");
    loadAdminData();
  };

  const deleteAsset = async (a: BrandAsset) => {
    if (!confirm(`Delete "${a.name}"?`)) return;
    if (a.storage_path) await supabase.storage.from("brand-assets").remove([a.storage_path]);
    await supabase.from("brand_assets").delete().eq("id", a.id);
    toast.success("Removed");
    loadAdminData();
  };

  const parseHexes = (raw: string): string[] =>
    raw.split(/[, \n]+/).map(s => s.trim()).filter(s => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s));

  const savePalette = async () => {
    const colors = parseHexes(newPaletteColors);
    if (!newPaletteName.trim() || colors.length === 0) {
      toast.error("Add a name and at least one valid #hex color");
      return;
    }
    setSavingPalette(true);
    const { error } = await supabase.from("brand_palettes").insert({
      name: newPaletteName.trim(), colors, created_by: user!.id,
    });
    setSavingPalette(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Palette added");
    setNewPaletteName("");
    setNewPaletteColors("#f08c00, #3a3a3a, #1a3c6e");
    loadAdminData();
  };

  const deletePalette = async (p: BrandPalette) => {
    if (!confirm(`Delete palette "${p.name}"?`)) return;
    const { error } = await supabase.from("brand_palettes").delete().eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Palette removed");
    loadAdminData();
  };

  if (authLoading || roleLoading) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!user) return <Navigate to="/auth" replace />;

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <AppNav />
        <main className="mx-auto max-w-2xl px-4 py-16 text-center space-y-4">
          <ShieldCheck className="h-12 w-12 text-primary mx-auto" />
          <h1 className="text-2xl font-bold">Admin access required</h1>
          {needsBootstrap ? (
            <>
              <p className="text-muted-foreground">No admin exists yet. Claim the admin role to manage API keys and the brand library.</p>
              <Button onClick={claimAdmin} disabled={bootstrapping}>
                {bootstrapping ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                Become the first admin
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground">Ask an existing admin to grant you access.</p>
          )}
        </main>
      </div>
    );
  }

  const hasKey = (p: string) => savedKeys.find(k => k.provider === p);

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="mx-auto max-w-5xl px-4 py-6 space-y-8">
        <PageBanner
          image={BANNERS.admin}
          eyebrow="Admin Console"
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          title="Studio Administration"
          subtitle="Manage AI provider keys and the shared brand library used across the studio."
          height="sm"
        />

        <Card id="api-keys" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> AI Model API Keys</CardTitle>
            <CardDescription>Paste a key here and the design team can immediately generate with that model. Keys are stored securely and never shown to non-admins.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Unite GPT (OpenAI / ChatGPT)</Label>
                {hasKey("openai") && (
                  <span className="text-xs text-primary font-medium flex items-center gap-2">
                    ✓ Configured
                    <button onClick={() => deleteKey("openai")} className="text-destructive hover:underline">remove</button>
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Input type="password" placeholder="sk-..." value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} />
                <Button onClick={() => saveKey("openai", openaiKey, "Unite GPT")} disabled={savingKey === "openai"}>
                  {savingKey === "openai" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Get from platform.openai.com → API keys. Used for image generation with gpt-image-1.</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Unite Flash (Google Gemini)</Label>
                {hasKey("gemini") ? (
                  <span className="text-xs text-primary font-medium flex items-center gap-2">
                    ✓ Configured
                    <button onClick={() => deleteKey("gemini")} className="text-destructive hover:underline">remove</button>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Falls back to Azure AI</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input type="password" placeholder="AIza..." value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} />
                <Button onClick={() => saveKey("gemini", geminiKey, "Unite Flash")} disabled={savingKey === "gemini"}>
                  {savingKey === "gemini" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Get from aistudio.google.com → Get API key. Optional — without it, Unite Flash uses Azure AI.</p>
            </div>
          </CardContent>
        </Card>

        <Card id="brand-assets" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ImagePlus className="h-5 w-5" /> Brand Library</CardTitle>
            <CardDescription>Upload official Unite Solar logos and approved imagery. Available to the whole design team in every studio.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3 items-center">
              <select value={uploadType} onChange={(e) => setUploadType(e.target.value as any)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="logo">Logo</option>
                <option value="image">Image</option>
              </select>
              <div className="relative flex-1">
                <input type="file" accept="image/*" onChange={uploadAsset} disabled={uploading} className="absolute inset-0 opacity-0 cursor-pointer" />
                <div className="h-10 rounded-md border-2 border-dashed border-border bg-muted/40 flex items-center justify-center text-sm text-muted-foreground">
                  {uploading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Uploading…</> : <>Click to upload {uploadType}</>}
                </div>
              </div>
            </div>

            {assets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No brand assets yet. Upload your first logo above.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {assets.map(a => (
                  <div key={a.id} className="group relative rounded-lg border border-border overflow-hidden bg-card">
                    <div className="aspect-square bg-muted/30 flex items-center justify-center p-2">
                      <img src={a.image_url} alt={a.name} className="max-w-full max-h-full object-contain" />
                    </div>
                    <div className="p-2 border-t border-border flex items-center justify-between gap-1">
                      <span className="text-xs truncate">{a.name}</span>
                      <button onClick={() => deleteAsset(a)} className="text-destructive hover:bg-destructive/10 p-1 rounded shrink-0">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="absolute top-1 left-1 text-[9px] uppercase tracking-wider bg-background/90 px-1.5 py-0.5 rounded">{a.asset_type}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card id="palettes" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5" /> Brand Palettes</CardTitle>
            <CardDescription>Define named color palettes. Designers can apply them with one click inside any editor (text colors, accents, backgrounds).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid sm:grid-cols-[1fr,2fr,auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Palette name</Label>
                <Input placeholder="e.g. Client A" value={newPaletteName} onChange={(e) => setNewPaletteName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hex colors (comma or space separated)</Label>
                <Input placeholder="#f08c00, #3a3a3a, #1a3c6e" value={newPaletteColors} onChange={(e) => setNewPaletteColors(e.target.value)} />
              </div>
              <Button onClick={savePalette} disabled={savingPalette}>
                {savingPalette ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Add</>}
              </Button>
            </div>

            {palettes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No palettes yet.</p>
            ) : (
              <div className="space-y-3">
                {palettes.map(p => (
                  <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{p.name}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {p.colors.map((c, i) => (
                          <div key={i} title={c}
                            className="h-7 w-7 rounded-md border border-border shadow-sm"
                            style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    </div>
                    <button onClick={() => deletePalette(p)} className="text-destructive hover:bg-destructive/10 p-2 rounded">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div id="residential-presets" className="scroll-mt-24"><ResidentialPresetsManager /></div>

        <div id="residential-offers" className="scroll-mt-24"><ResidentialOffersManager /></div>

        <div id="proposal-settings" className="scroll-mt-24"><ProposalSettingsManager /></div>

        <div id="fixed-slides" className="scroll-mt-24"><FixedSlidesManager /></div>

        <Card id="users" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" /> Admin Users
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {adminCount} / {maxAdmins} admins
              </span>
            </CardTitle>
            <CardDescription>
              Grant admin by email — if the user doesn't exist, an invitation email is sent automatically with a link to verify their email and set a password. Up to {maxAdmins} admins.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid sm:grid-cols-[1fr,auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Email of user to make admin</Label>
                <Input
                  type="email"
                  placeholder="person@company.com"
                  value={grantEmail}
                  onChange={(e) => setGrantEmail(e.target.value)}
                  disabled={adminCount >= maxAdmins}
                />
              </div>
              <Button onClick={grantAdmin} disabled={granting || adminCount >= maxAdmins}>
                {granting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><UserPlus className="h-4 w-4 mr-1" /> Grant & invite</>}
              </Button>
            </div>
            {adminCount >= maxAdmins && (
              <p className="text-xs text-destructive">
                Admin limit reached. Revoke an existing admin to add a new one.
              </p>
            )}

            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Label className="text-xs">All users</Label>
                  <span className="text-xs text-muted-foreground">({managedUsers.length})</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search by email..."
                      value={userSearchQuery}
                      onChange={(e) => { setUserSearchQuery(e.target.value); setUserPage(1); }}
                      className="h-8 w-40 sm:w-48 text-sm pl-8"
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={loadUsers} disabled={usersLoading}>
                    {usersLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
                  </Button>
                </div>
              </div>

              {(() => {
                const filteredUsers = managedUsers.filter(u =>
                  u.email.toLowerCase().includes(userSearchQuery.toLowerCase())
                );
                const totalPages = Math.ceil(filteredUsers.length / USERS_PER_PAGE);
                const startIdx = (userPage - 1) * USERS_PER_PAGE;
                const pageUsers = filteredUsers.slice(startIdx, startIdx + USERS_PER_PAGE);

                return (
                  <>
                    {filteredUsers.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        {userSearchQuery ? "No users match your search." : "No users loaded."}
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-[28rem] overflow-y-auto">
                        {pageUsers.map(u => {
                          const isAdminUser = u.roles.includes("admin");
                          const verified = !!u.email_confirmed_at;
                          const isMe = u.id === user?.id;
                          const busy = actioningEmail === u.email;
                          return (
                            <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border border-border bg-card">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium truncate">{u.email}</p>
                                  {isAdminUser && <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">Admin</span>}
                                  {verified ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                                      <CheckCircle2 className="h-3 w-3" /> Verified
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                                      <Clock className="h-3 w-3" /> Pending verification
                                    </span>
                                  )}
                                  {isMe && <span className="text-[10px] text-muted-foreground">(you)</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-wrap">
                                {!verified && (
                                  <Button variant="ghost" size="sm" onClick={() => resendVerification(u.email)} disabled={busy}>
                                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Mail className="h-3 w-3 mr-1" /> Resend verify</>}
                                  </Button>
                                )}
                                <Button variant="ghost" size="sm" onClick={() => sendPasswordReset(u.email)} disabled={busy}>
                                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <><KeyRound className="h-3 w-3 mr-1" /> Reset password</>}
                                </Button>
                                {isAdminUser && !isMe && (
                                  <Button variant="ghost" size="sm" onClick={() => revokeAdmin(u.email)} disabled={busy}>
                                    <UserMinus className="h-3 w-3 mr-1" /> Revoke
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4 pt-2 border-t border-border">
                        <span className="text-xs text-muted-foreground">
                          Showing {startIdx + 1}-{Math.min(startIdx + USERS_PER_PAGE, filteredUsers.length)} of {filteredUsers.length}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setUserPage(p => Math.max(1, p - 1))}
                            disabled={userPage === 1}
                          >
                            Previous
                          </Button>
                          <span className="text-sm px-2">{userPage} / {totalPages}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setUserPage(p => Math.min(totalPages, p + 1))}
                            disabled={userPage === totalPages}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default AdminPage;
