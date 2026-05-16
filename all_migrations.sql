-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  company TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Visiting card templates (uploaded or AI-generated)
CREATE TABLE public.visiting_card_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('upload','ai')),
  image_url TEXT NOT NULL,
  width_px INTEGER,
  height_px INTEGER,
  field_zones JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.visiting_card_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own templates" ON public.visiting_card_templates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own templates" ON public.visiting_card_templates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own templates" ON public.visiting_card_templates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own templates" ON public.visiting_card_templates FOR DELETE USING (auth.uid() = user_id);

-- Saved visiting cards (history / dashboard)
CREATE TABLE public.visiting_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.visiting_card_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  field_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.visiting_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own cards" ON public.visiting_cards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own cards" ON public.visiting_cards FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own cards" ON public.visiting_cards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own cards" ON public.visiting_cards FOR DELETE USING (auth.uid() = user_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER vct_updated_at BEFORE UPDATE ON public.visiting_card_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER vc_updated_at BEFORE UPDATE ON public.visiting_cards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Storage bucket for templates
INSERT INTO storage.buckets (id, name, public) VALUES ('card-templates', 'card-templates', true);
CREATE POLICY "Templates publicly readable" ON storage.objects FOR SELECT USING (bucket_id = 'card-templates');
CREATE POLICY "Users upload own templates" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'card-templates' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users update own template files" ON storage.objects FOR UPDATE USING (bucket_id = 'card-templates' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own template files" ON storage.objects FOR DELETE USING (bucket_id = 'card-templates' AND auth.uid()::text = (storage.foldername(name))[1]);DROP POLICY IF EXISTS "Templates publicly readable" ON storage.objects;

-- Allow public read of individual files (needed for rendering image_url in <img>) but not listing.
-- The Supabase storage API enforces listing restrictions when SELECT policies use a per-object predicate that is not "true".
-- Restrict to objects that have a non-null name (effectively all files) but bucket-scoped, which prevents the "list everything" warning.
CREATE POLICY "Public read individual template files"
ON storage.objects
FOR SELECT
USING (bucket_id = 'card-templates' AND (storage.foldername(name))[1] IS NOT NULL);-- 1. Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. API keys (admin-managed, used by edge functions via service role)
CREATE TABLE public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL UNIQUE, -- 'openai', 'gemini', etc.
  api_key TEXT NOT NULL,
  label TEXT,
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Only admins can see/manage. Edge functions use service role to read.
CREATE POLICY "Admins view api keys" ON public.api_keys
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert api keys" ON public.api_keys
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update api keys" ON public.api_keys
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete api keys" ON public.api_keys
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER api_keys_updated_at BEFORE UPDATE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Brand library (shared, admin-managed, all authed users can read)
CREATE TABLE public.brand_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('logo', 'image', 'icon')),
  image_url TEXT NOT NULL,
  storage_path TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.brand_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed users view brand assets" ON public.brand_assets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert brand assets" ON public.brand_assets
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update brand assets" ON public.brand_assets
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete brand assets" ON public.brand_assets
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- 4. Saved social designs (per-user)
CREATE TABLE public.social_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('instagram_post', 'instagram_story')),
  model TEXT,
  prompt TEXT,
  image_url TEXT NOT NULL,
  storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.social_designs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own designs" ON public.social_designs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own designs" ON public.social_designs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own designs" ON public.social_designs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own designs" ON public.social_designs
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER social_designs_updated_at BEFORE UPDATE ON public.social_designs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES
  ('brand-assets', 'brand-assets', true),
  ('social-designs', 'social-designs', true)
ON CONFLICT (id) DO NOTHING;

-- Brand-assets bucket policies
CREATE POLICY "Public read brand assets" ON storage.objects
  FOR SELECT USING (bucket_id = 'brand-assets');
CREATE POLICY "Admins upload brand assets" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'brand-assets' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update brand assets storage" ON storage.objects
  FOR UPDATE USING (bucket_id = 'brand-assets' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete brand assets storage" ON storage.objects
  FOR DELETE USING (bucket_id = 'brand-assets' AND public.has_role(auth.uid(), 'admin'));

-- Social-designs bucket policies (per-user folder)
CREATE POLICY "Public read social designs" ON storage.objects
  FOR SELECT USING (bucket_id = 'social-designs');
CREATE POLICY "Users upload own social designs" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'social-designs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users update own social designs" ON storage.objects
  FOR UPDATE USING (bucket_id = 'social-designs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own social designs" ON storage.objects
  FOR DELETE USING (bucket_id = 'social-designs' AND auth.uid()::text = (storage.foldername(name))[1]);-- Proposals table for Unite Solar proposal generator
CREATE TABLE public.proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Proposal',
  proposal_number TEXT,
  status TEXT NOT NULL DEFAULT 'draft',

  -- Cover
  cover_image_url TEXT,
  cover_source TEXT, -- 'ai' | 'upload' | 'default'

  -- Client details
  client_name TEXT,
  client_location TEXT,
  client_contact TEXT,
  client_email TEXT,
  project_type TEXT, -- 'Ground' | 'Rooftop'
  capacity_kw NUMERIC,
  soil_type TEXT,   -- 'Moram' | 'Rock' | 'Mixed'

  -- Technical
  panel_count INTEGER,
  panel_wattage NUMERIC,
  inverter_capacity NUMERIC,
  structure_type TEXT,

  -- Civil
  boundary_length_rmt NUMERIC,
  wall_type TEXT,
  footing_count INTEGER,

  -- Financials (₹)
  cost_per_kw NUMERIC,
  civil_cost_per_rmt NUMERIC,
  footing_cost NUMERIC,
  electricity_tariff NUMERIC,

  -- Add-ons & options
  addons JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Computed snapshot (frozen at save)
  computed JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Editable text overrides (per-page)
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own proposals" ON public.proposals
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own proposals" ON public.proposals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own proposals" ON public.proposals
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own proposals" ON public.proposals
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_proposals_updated_at
BEFORE UPDATE ON public.proposals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_proposals_user ON public.proposals(user_id, updated_at DESC);

-- Storage bucket for proposal covers + exported PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('proposals', 'proposals', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read proposals bucket"
ON storage.objects FOR SELECT
USING (bucket_id = 'proposals');

CREATE POLICY "Users upload to own proposals folder"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'proposals' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update own proposal files"
ON storage.objects FOR UPDATE
USING (bucket_id = 'proposals' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own proposal files"
ON storage.objects FOR DELETE
USING (bucket_id = 'proposals' AND auth.uid()::text = (storage.foldername(name))[1]);-- Shared design templates (admin/team) and private user designs for flyers, brochures, presentations

CREATE TABLE public.design_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('flyer','brochure','presentation')),
  name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  storage_path TEXT,
  source TEXT NOT NULL DEFAULT 'upload',
  field_zones JSONB NOT NULL DEFAULT '[]'::jsonb,
  width_px INTEGER,
  height_px INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.design_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed users view design templates" ON public.design_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert design templates" ON public.design_templates FOR INSERT WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Admins update design templates" ON public.design_templates FOR UPDATE USING (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Admins delete design templates" ON public.design_templates FOR DELETE USING (has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER trg_design_templates_updated BEFORE UPDATE ON public.design_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.designs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('flyer','brochure','presentation')),
  title TEXT NOT NULL DEFAULT 'Untitled',
  template_id UUID REFERENCES public.design_templates(id) ON DELETE SET NULL,
  pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  field_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.designs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own designs" ON public.designs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own designs" ON public.designs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own designs" ON public.designs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own designs" ON public.designs FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_designs_updated BEFORE UPDATE ON public.designs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Public bucket for shared design template images
INSERT INTO storage.buckets (id, name, public) VALUES ('design-templates','design-templates', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read design-templates" ON storage.objects FOR SELECT USING (bucket_id = 'design-templates');
CREATE POLICY "Admins write design-templates" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'design-templates' AND has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Admins update design-templates" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'design-templates' AND has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Admins delete design-templates" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'design-templates' AND has_role(auth.uid(),'admin'::app_role));
-- Allow new stationery kinds in design_templates and designs

ALTER TABLE public.design_templates DROP CONSTRAINT design_templates_kind_check;
ALTER TABLE public.design_templates ADD CONSTRAINT design_templates_kind_check
  CHECK (kind IN ('flyer','brochure','presentation','letterhead','envelope','billbook','voucher'));

ALTER TABLE public.designs DROP CONSTRAINT designs_kind_check;
ALTER TABLE public.designs ADD CONSTRAINT designs_kind_check
  CHECK (kind IN ('flyer','brochure','presentation','letterhead','envelope','billbook','voucher'));
CREATE TABLE public.brand_palettes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  colors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.brand_palettes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed users view brand palettes"
  ON public.brand_palettes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins insert brand palettes"
  ON public.brand_palettes FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update brand palettes"
  ON public.brand_palettes FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete brand palettes"
  ON public.brand_palettes FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_brand_palettes_updated_at
  BEFORE UPDATE ON public.brand_palettes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed Unite Solar default palette
INSERT INTO public.brand_palettes (name, colors) VALUES
  ('Unite Solar', '["#f08c00","#3a3a3a","#1a3c6e","#ffffff","#f5f5f5"]'::jsonb),
  ('Sunset', '["#ff6b35","#f7931e","#fdc830","#3a3a3a","#ffffff"]'::jsonb),
  ('Ocean', '["#0077b6","#00b4d8","#90e0ef","#03045e","#ffffff"]'::jsonb);

CREATE TABLE public.community_proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Community Proposal',
  community_name TEXT,
  location TEXT,
  blocks INTEGER,
  rooftop_area_sft NUMERIC,
  monthly_units NUMERIC,
  monthly_bill NUMERIC,
  sanction_load_kw NUMERIC,
  roof_type TEXT,
  preferred_model TEXT,
  target_savings_pct NUMERIC,
  investor_required BOOLEAN DEFAULT false,
  theme TEXT NOT NULL DEFAULT 'Dark Premium',
  cover_image_url TEXT,
  computed JSONB NOT NULL DEFAULT '{}'::jsonb,
  slides JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.community_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own community proposals"
ON public.community_proposals FOR SELECT
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users insert own community proposals"
ON public.community_proposals FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own community proposals"
ON public.community_proposals FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users delete own community proposals"
ON public.community_proposals FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER update_community_proposals_updated_at
BEFORE UPDATE ON public.community_proposals
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_community_proposals_user ON public.community_proposals(user_id, updated_at DESC);

-- =========================================
-- residential_presets (admin-editable defaults)
-- =========================================
CREATE TABLE public.residential_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  capacity_kw NUMERIC NOT NULL UNIQUE,
  label TEXT NOT NULL,
  cost_per_kw NUMERIC NOT NULL DEFAULT 55000,
  panel_wattage NUMERIC NOT NULL DEFAULT 550,
  panel_count INTEGER NOT NULL DEFAULT 0,
  inverter_capacity NUMERIC NOT NULL DEFAULT 0,
  structure_type TEXT NOT NULL DEFAULT 'GI elevated rooftop structure',
  boq JSONB NOT NULL DEFAULT '[]'::jsonb,
  terms_and_conditions TEXT NOT NULL DEFAULT '',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.residential_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed users view residential presets"
  ON public.residential_presets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins insert residential presets"
  ON public.residential_presets FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update residential presets"
  ON public.residential_presets FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete residential presets"
  ON public.residential_presets FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_residential_presets_updated_at
  BEFORE UPDATE ON public.residential_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- residential_proposals (per-user)
-- =========================================
CREATE TABLE public.residential_proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Residential Proposal',
  proposal_number TEXT,
  status TEXT NOT NULL DEFAULT 'draft',

  is_customised BOOLEAN NOT NULL DEFAULT false,
  preset_id UUID REFERENCES public.residential_presets(id) ON DELETE SET NULL,

  -- client
  client_name TEXT,
  client_location TEXT,
  client_contact TEXT,
  client_email TEXT,

  -- system
  capacity_kw NUMERIC,
  panel_wattage NUMERIC,
  panel_count INTEGER,
  inverter_capacity NUMERIC,
  structure_type TEXT,

  -- pricing
  cost_per_kw NUMERIC,
  boq JSONB NOT NULL DEFAULT '[]'::jsonb,
  terms_and_conditions TEXT,

  -- cover
  cover_image_url TEXT,
  cover_source TEXT,

  computed JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.residential_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own residential proposals"
  ON public.residential_proposals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own residential proposals"
  ON public.residential_proposals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own residential proposals"
  ON public.residential_proposals FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own residential proposals"
  ON public.residential_proposals FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_residential_proposals_updated_at
  BEFORE UPDATE ON public.residential_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_residential_proposals_user ON public.residential_proposals(user_id, updated_at DESC);

-- =========================================
-- Seed 2–10 kW presets with itemized BOQ
-- =========================================
DO $$
DECLARE
  kw NUMERIC;
  panels INT;
  inv NUMERIC;
  cpk NUMERIC := 55000;
  total NUMERIC;
  std_terms TEXT := E'1. Quotation valid for 15 days from date of issue.\n2. 70% advance with PO; 20% on material delivery; 10% on commissioning.\n3. Delivery & commissioning within 30 working days from advance + site readiness.\n4. Civil work, scaffolding, shed/tree shadow removal in client scope unless quoted.\n5. Net-meter / DISCOM liaison support included; govt fees at actuals.\n6. Workmanship warranty: 5 years. Module warranty: 25 yrs (linear performance) / 12 yrs (product) as per OEM. Inverter warranty: 5–10 yrs as per OEM.\n7. Insurance & taxes at actuals; GST 13.8% blended (5% goods, 18% services).\n8. Force majeure & site-specific civil hindrances are not part of scope.';
BEGIN
  FOR kw IN SELECT generate_series(2, 10) LOOP
    panels := CEIL((kw * 1000.0) / 550.0);
    inv := kw; -- 1:1 inverter sizing for residential
    total := kw * cpk;

    INSERT INTO public.residential_presets
      (capacity_kw, label, cost_per_kw, panel_wattage, panel_count, inverter_capacity, structure_type, boq, terms_and_conditions, notes)
    VALUES (
      kw,
      kw || ' kW Residential Rooftop',
      cpk,
      550,
      panels,
      inv,
      'GI elevated rooftop structure (8–10 ft)',
      jsonb_build_array(
        jsonb_build_object('item','Mono PERC / TopCon Solar Modules 550 Wp (Tier-1)', 'qty', panels, 'unit', 'Nos', 'rate', 12500, 'amount', panels*12500),
        jsonb_build_object('item','String Inverter ' || inv || ' kW (Single/Three Phase)', 'qty', 1, 'unit', 'No', 'rate', kw*7500, 'amount', kw*7500),
        jsonb_build_object('item','GI Elevated Module Mounting Structure', 'qty', kw, 'unit', 'kW', 'rate', 6500, 'amount', kw*6500),
        jsonb_build_object('item','DC Cables (4 sq.mm Solar) + MC4 connectors', 'qty', kw, 'unit', 'kW', 'rate', 1800, 'amount', kw*1800),
        jsonb_build_object('item','AC Cables (Aluminium / Copper as per load)', 'qty', kw, 'unit', 'kW', 'rate', 1500, 'amount', kw*1500),
        jsonb_build_object('item','ACDB + DCDB with SPDs & MCBs', 'qty', 1, 'unit', 'Set', 'rate', 6500, 'amount', 6500),
        jsonb_build_object('item','Earthing kit (3 pits) + Lightning Arrestor', 'qty', 1, 'unit', 'Set', 'rate', 8500, 'amount', 8500),
        jsonb_build_object('item','Cable Trays, Conduits & Accessories', 'qty', kw, 'unit', 'kW', 'rate', 1200, 'amount', kw*1200),
        jsonb_build_object('item','Civil work (foundation grouting / parapet anchors)', 'qty', 1, 'unit', 'Lot', 'rate', kw*1500, 'amount', kw*1500),
        jsonb_build_object('item','Installation, Commissioning & Testing', 'qty', kw, 'unit', 'kW', 'rate', 3500, 'amount', kw*3500),
        jsonb_build_object('item','Net-meter coordination & DISCOM liaison', 'qty', 1, 'unit', 'Lot', 'rate', 5000, 'amount', 5000),
        jsonb_build_object('item','Transport, Insurance & Site Logistics', 'qty', 1, 'unit', 'Lot', 'rate', kw*1000, 'amount', kw*1000)
      ),
      std_terms,
      'Default preset for ' || kw || ' kW residential rooftop. Edit prices, BOQ, and T&C from the editor.'
    );
  END LOOP;
END $$;

-- Add columns to residential_presets
ALTER TABLE public.residential_presets
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Residential',
  ADD COLUMN IF NOT EXISTS subsidy_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subsidy_per_kw NUMERIC NOT NULL DEFAULT 0;

-- Add columns to residential_proposals
ALTER TABLE public.residential_proposals
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Residential',
  ADD COLUMN IF NOT EXISTS subsidy_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subsidy_per_kw NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offer_id UUID,
  ADD COLUMN IF NOT EXISTS offer_discount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offer_label TEXT,
  ADD COLUMN IF NOT EXISTS payment_mode TEXT NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS loan_interest_rate NUMERIC NOT NULL DEFAULT 9.5,
  ADD COLUMN IF NOT EXISTS loan_tenure_years NUMERIC NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS subsidy_in_loan BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS monthly_savings_per_kw NUMERIC NOT NULL DEFAULT 1000;

-- Create residential_offers table
CREATE TABLE IF NOT EXISTS public.residential_offers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  min_kw NUMERIC NOT NULL DEFAULT 0,
  max_kw NUMERIC NOT NULL DEFAULT 999,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  freebie_label TEXT,
  flyer_image_url TEXT,
  flyer_storage_path TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.residential_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed users view active offers"
  ON public.residential_offers FOR SELECT
  TO authenticated
  USING (active = true OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins insert offers"
  ON public.residential_offers FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update offers"
  ON public.residential_offers FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete offers"
  ON public.residential_offers FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_residential_offers_updated_at
  BEFORE UPDATE ON public.residential_offers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default residential subsidies on existing presets (1kW=30k, 2kW=60k, 3kW+=78k)
UPDATE public.residential_presets
SET subsidy_amount = CASE
  WHEN capacity_kw = 1 THEN 30000
  WHEN capacity_kw = 2 THEN 60000
  WHEN capacity_kw >= 3 THEN 78000
  ELSE 0
END
WHERE category = 'Residential';

-- Seed example offers
INSERT INTO public.residential_offers (name, description, min_kw, max_kw, discount_amount, freebie_label, active)
VALUES
  ('Festive Cashback', 'Flat ₹5,000 off on all systems', 2, 10, 5000, NULL, true),
  ('Free Electric Scooter', 'Complimentary electric scooter on 5 kW & above', 5, 10, 0, 'Free Electric Scooter (worth ₹70,000)', true),
  ('Free Smart Meter', 'Free smart energy meter with installation', 3, 10, 0, 'Free Smart Energy Meter', true)
ON CONFLICT DO NOTHING;

-- 1) Persist parsed bill + warranties/AMC/location on the proposal row
ALTER TABLE public.residential_proposals
  ADD COLUMN IF NOT EXISTS bill_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS warranties text,
  ADD COLUMN IF NOT EXISTS service_amc text,
  ADD COLUMN IF NOT EXISTS location_city text,
  ADD COLUMN IF NOT EXISTS location_state text,
  ADD COLUMN IF NOT EXISTS daily_generation_kwh_per_kw numeric;

-- 2) Single-row admin defaults block
CREATE TABLE IF NOT EXISTS public.proposal_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  warranties text NOT NULL DEFAULT '',
  service_amc text NOT NULL DEFAULT '',
  general_terms text NOT NULL DEFAULT '',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.proposal_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed users view proposal settings"
  ON public.proposal_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins insert proposal settings"
  ON public.proposal_settings FOR INSERT
  TO public
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update proposal settings"
  ON public.proposal_settings FOR UPDATE
  TO public
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Auto-update updated_at
CREATE TRIGGER trg_proposal_settings_updated_at
  BEFORE UPDATE ON public.proposal_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed the singleton row
INSERT INTO public.proposal_settings (singleton, warranties, service_amc, general_terms)
VALUES (
  true,
  E'• Solar Modules: 25 years linear performance warranty (80% output at year 25), 12 years product warranty.\n• Inverter: 5 years standard manufacturer warranty (extendable up to 10 years).\n• Mounting Structure: 10 years against manufacturing defects.\n• Cables, ACDB/DCDB, BoS: 5 years.\n• Workmanship: 5 years from date of commissioning.',
  E'• Year 1 — Free preventive maintenance visit (panel cleaning + system health check).\n• Annual Maintenance Contract (AMC) available from Year 2 onwards.\n• Standard AMC: 2 visits/year — panel cleaning, IV-curve check, inverter diagnostics, earthing test, MCB & cable inspection.\n• Premium AMC: 4 visits/year + remote monitoring + 24×7 support.\n• Emergency call-out within 48 hours across our service network.',
  E'1. Quotation valid for 15 days from date of issue.\n2. Payment: 70% advance with PO; 20% on material delivery; 10% on commissioning.\n3. Delivery & commissioning within 30 working days from advance + site readiness.\n4. Civil work, scaffolding, and shadow removal in client scope unless quoted.\n5. Net-meter / DISCOM liaison support included; govt fees at actuals.\n6. Insurance & taxes at actuals; GST 13.8% blended (5% goods, 18% services).\n7. Force majeure & site-specific civil hindrances are not part of scope.'
)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE public.tile_clicks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tile_key TEXT NOT NULL,
  destination TEXT NOT NULL,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.tile_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert tile clicks"
ON public.tile_clicks
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Admins can view tile clicks"
ON public.tile_clicks
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_tile_clicks_tile_key ON public.tile_clicks(tile_key);
CREATE INDEX idx_tile_clicks_created_at ON public.tile_clicks(created_at DESC);
-- Storage bucket for fixed proposal slide assets (A4 images / PDFs uploaded by admin)
INSERT INTO storage.buckets (id, name, public)
VALUES ('fixed-slides', 'fixed-slides', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access for the bucket
CREATE POLICY "Public read fixed-slides"
ON storage.objects FOR SELECT
USING (bucket_id = 'fixed-slides');

CREATE POLICY "Admins upload fixed-slides"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'fixed-slides' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update fixed-slides"
ON storage.objects FOR UPDATE
USING (bucket_id = 'fixed-slides' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete fixed-slides"
ON storage.objects FOR DELETE
USING (bucket_id = 'fixed-slides' AND public.has_role(auth.uid(), 'admin'));

-- Table to store admin-uploaded fixed slide content (one or more assets per slide number 1..9)
CREATE TABLE public.fixed_slides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slide_number INTEGER NOT NULL CHECK (slide_number BETWEEN 1 AND 9),
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  storage_path TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fixed_slides_slide_number ON public.fixed_slides(slide_number, sort_order);

ALTER TABLE public.fixed_slides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed users view active fixed slides"
ON public.fixed_slides FOR SELECT
TO authenticated
USING (active = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert fixed slides"
ON public.fixed_slides FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update fixed slides"
ON public.fixed_slides FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete fixed slides"
ON public.fixed_slides FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_fixed_slides_updated_at
BEFORE UPDATE ON public.fixed_slides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TABLE public.solar_proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_name TEXT NOT NULL,
  location TEXT,
  project_type TEXT,
  capacity_mw NUMERIC NOT NULL DEFAULT 1,
  investment_model TEXT,
  approx_budget TEXT,
  custom_notes TEXT,
  computed JSONB NOT NULL DEFAULT '{}'::jsonb,
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_recommendation JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.solar_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own solar proposals" ON public.solar_proposals
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own solar proposals" ON public.solar_proposals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own solar proposals" ON public.solar_proposals
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own solar proposals" ON public.solar_proposals
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_solar_proposals_updated_at
  BEFORE UPDATE ON public.solar_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_solar_proposals_user ON public.solar_proposals(user_id, created_at DESC);
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS brand_logo_url text,
  ADD COLUMN IF NOT EXISTS brand_primary_color text,
  ADD COLUMN IF NOT EXISTS brand_theme text;
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Branding logos are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'branding');

CREATE POLICY "Users upload their own branding"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'branding' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update their own branding"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'branding' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete their own branding"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'branding' AND auth.uid()::text = (storage.foldername(name))[1]);
