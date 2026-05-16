import React, { useEffect, useRef, useState } from "react";
import AppNav from "@/components/AppNav";
import PageBanner, { BANNERS } from "@/components/PageBanner";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Sparkles, Image as ImageIcon, Loader2, Download, Save, Upload, Trash2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SOCIAL_FORMATS, FORMAT_BY_ID, type SocialFormat } from "@/lib/social-formats";

type Format = SocialFormat;

interface BrandAsset { id: string; name: string; asset_type: string; image_url: string; }
interface SavedDesign { id: string; title: string; format: string; image_url: string; created_at: string; }

const FORMAT_INFO = FORMAT_BY_ID;

const SocialMedia: React.FC = () => {
  const { user, loading } = useAuth();
  const [format, setFormat] = useState<Format>("instagram_post");
    const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);

  const [brandAssets, setBrandAssets] = useState<BrandAsset[]>([]);
  const [savedDesigns, setSavedDesigns] = useState<SavedDesign[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("brand_assets").select("id,name,asset_type,image_url").order("created_at", { ascending: false })
      .then(({ data }) => setBrandAssets(data ?? []));
    supabase.from("social_designs").select("id,title,format,image_url,created_at").order("created_at", { ascending: false })
      .then(({ data }) => setSavedDesigns(data ?? []));
  }, [user]);

  if (loading) return <div className="min-h-screen grid place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!user) return <Navigate to="/auth" replace />;

  const generate = async () => {
    if (!prompt.trim()) { toast.error("Describe what you want to design"); return; }
    setGenerating(true);
    setGenerated(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-social-design", {
        body: { prompt: prompt.trim(), format },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.image) throw new Error("No image returned");
      setGenerated(data.image);
      toast.success("Design generated!");
    } catch (e: any) {
      toast.error(e.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const uploadOwnDesign = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setGenerated(ev.target?.result as string);
      toast.success("Design loaded");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const downloadImage = async (url: string, name: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { toast.error("Download failed"); }
  };

  const saveDesign = async () => {
    if (!generated || !user) return;
    try {
      // If data URL, upload to storage; if remote URL, fetch first.
      const blob = await (await fetch(generated)).blob();
      const path = `${user.id}/${Date.now()}.png`;
      const { error: upErr } = await supabase.storage.from("social-designs").upload(path, blob, { contentType: "image/png" });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("social-designs").getPublicUrl(path);
      const { error } = await supabase.from("social_designs").insert({
        user_id: user.id,
        title: prompt.slice(0, 60) || `${FORMAT_INFO[format].label} design`,
        format, model, prompt, image_url: publicUrl, storage_path: path,
      });
      if (error) throw error;
      toast.success("Saved to your library");
      const { data } = await supabase.from("social_designs").select("id,title,format,image_url,created_at").order("created_at", { ascending: false });
      setSavedDesigns(data ?? []);
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    }
  };

  const deleteDesign = async (d: SavedDesign) => {
    if (!confirm(`Delete "${d.title}"?`)) return;
    await supabase.from("social_designs").delete().eq("id", d.id);
    setSavedDesigns(prev => prev.filter(x => x.id !== d.id));
    toast.success("Deleted");
  };

  const FormatIcon = FORMAT_INFO[format].icon;

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        <PageBanner
          image={BANNERS.social}
          eyebrow="Social Media Studio"
          icon={<Sparkles className="h-3.5 w-3.5" />}
          title="Design for every social network"
          subtitle="Generate ready-to-post graphics for Instagram, Facebook, LinkedIn, X and YouTube — sized perfectly out of the box."
          height="md"
        />

        <Tabs defaultValue="create">
          <TabsList>
            <TabsTrigger value="create">Create</TabsTrigger>
            <TabsTrigger value="library">My Library ({savedDesigns.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="space-y-6 mt-6">
            <div className="grid lg:grid-cols-[1fr,1.2fr] gap-6">
              {/* Controls */}
              <div className="space-y-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">1. Pick a format</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {SOCIAL_FORMATS.map((f) => {
                        const Icon = f.icon;
                        const PIcon = f.platformIcon;
                        const active = format === f.id;
                        return (
                          <button key={f.id} onClick={() => setFormat(f.id)}
                            className={`p-3 rounded-lg border-2 transition-all text-left relative overflow-hidden group ${active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                            <div className={`absolute inset-0 opacity-0 group-hover:opacity-5 bg-gradient-to-br ${f.hue}`} />
                            <div className="relative flex items-center gap-2 mb-1">
                              <PIcon className="h-4 w-4 text-primary" />
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <div className="relative font-semibold text-xs leading-tight">{f.label}</div>
                            <div className="relative text-[10px] text-muted-foreground">{f.w}×{f.h}</div>
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base">2. Describe your design</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="E.g., Bold orange and dark grey Unite Solar promo for a 30% off summer offer, solar panels on a rooftop, sunny sky, leave space at top for headline."
                      className="min-h-[120px]" disabled={generating} />
                    <div className="flex gap-2">
                      <Button onClick={generate} disabled={generating || !prompt.trim()} className="flex-1">
                        {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</> : <><Sparkles className="h-4 w-4 mr-2" /> Generate</>}
                      </Button>
                      <Button variant="outline" onClick={() => fileRef.current?.click()}>
                        <Upload className="h-4 w-4 mr-2" /> Upload
                      </Button>
                      <input ref={fileRef} type="file" accept="image/*" onChange={uploadOwnDesign} className="hidden" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Brand Library</CardTitle>
                    <CardDescription className="text-xs">Click any asset to download/use. Admins manage these.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {brandAssets.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-3">No brand assets yet. Ask an admin to upload logos.</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {brandAssets.map(a => (
                          <button key={a.id} onClick={() => downloadImage(a.image_url, a.name)}
                            className="aspect-square rounded-lg border border-border bg-muted/30 p-2 flex items-center justify-center hover:border-primary transition-colors group relative">
                            <img src={a.image_url} alt={a.name} className="max-w-full max-h-full object-contain" />
                            <Download className="h-4 w-4 absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 text-primary" />
                          </button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Preview */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><FormatIcon className="h-4 w-4" /> Preview — {FORMAT_INFO[format].label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`mx-auto ${format === "instagram_story" ? "max-w-xs" : format === "instagram_post" ? "max-w-md" : "max-w-2xl"}`}>
                    <div className={`${FORMAT_INFO[format].aspect} rounded-xl border-2 border-dashed border-border bg-muted/30 overflow-hidden flex items-center justify-center`}>
                      {generated ? (
                        <img src={generated} alt="Generated design" className="w-full h-full object-cover" />
                      ) : generating ? (
                        <div className="text-center text-muted-foreground">
                          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                          <p className="text-sm">Generating with AI…</p>
                        </div>
                      ) : (
                        <div className="text-center text-muted-foreground p-6">
                          <ImageIcon className="h-10 w-10 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">Your design will appear here</p>
                        </div>
                      )}
                    </div>
                  </div>
                  {generated && (
                    <div className="flex gap-2 mt-4 justify-center">
                      <Button onClick={saveDesign}><Save className="h-4 w-4 mr-2" /> Save to Library</Button>
                      <Button variant="outline" onClick={() => downloadImage(generated, `unite-${format}-${Date.now()}`)}>
                        <Download className="h-4 w-4 mr-2" /> Download
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="library" className="mt-6">
            {savedDesigns.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">No saved designs yet. Generate one and click "Save to Library".</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {savedDesigns.map(d => (
                  <Card key={d.id} className="overflow-hidden group">
                    <div className={`${FORMAT_INFO[d.format as Format]?.aspect ?? "aspect-square"} bg-muted/30 relative`}>
                      <img src={d.image_url} alt={d.title} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <Button size="sm" variant="secondary" onClick={() => downloadImage(d.image_url, d.title)}>
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => deleteDesign(d)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-medium truncate">{d.title}</p>
                      <p className="text-[10px] text-muted-foreground">{FORMAT_INFO[d.format as Format]?.label}</p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default SocialMedia;
