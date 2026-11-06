-- ══════════════════════════════════════════════════════════════
-- FastFit — Supabase Database Setup
-- Run this SQL in the Supabase SQL Editor (Dashboard > SQL Editor)
-- ══════════════════════════════════════════════════════════════

-- 1. Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  shop_name TEXT DEFAULT '',
  address TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create person_images table
CREATE TABLE IF NOT EXISTS person_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create item_images table
CREATE TABLE IF NOT EXISTS item_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Create try_ons table
CREATE TABLE IF NOT EXISTS try_ons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  person_image_id UUID,
  person_image_url TEXT NOT NULL,
  item_ids UUID[] DEFAULT '{}',
  item_images JSONB DEFAULT '[]'::jsonb,
  result_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Enable Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE try_ons ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies — Users can only access their own data
-- Profiles
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- Try Ons
CREATE POLICY "Users can view own try ons" ON try_ons
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own try ons" ON try_ons
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own try ons" ON try_ons
  FOR DELETE USING (auth.uid() = user_id);

-- Person Images
CREATE POLICY "Users can view own person images" ON person_images
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own person images" ON person_images
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own person images" ON person_images
  FOR DELETE USING (auth.uid() = user_id);

-- Item Images
CREATE POLICY "Users can view own item images" ON item_images
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own item images" ON item_images
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own item images" ON item_images
  FOR DELETE USING (auth.uid() = user_id);

-- 7. Updated_at trigger for profiles
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ══════════════════════════════════════════════════════════════
-- Storage Buckets Setup
-- Run these separately or create via the Supabase Dashboard:
-- Storage > New Bucket
-- ══════════════════════════════════════════════════════════════

-- Create storage buckets (you may need to do this via Dashboard)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('person-images', 'person-images', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public) 
VALUES ('item-images', 'item-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS Policies
-- Person Images bucket
CREATE POLICY "Users can upload person images" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'person-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view person images" ON storage.objects
  FOR SELECT USING (bucket_id = 'person-images');

CREATE POLICY "Users can delete own person images" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'person-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Item Images bucket
CREATE POLICY "Users can upload item images" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'item-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view item images" ON storage.objects
  FOR SELECT USING (bucket_id = 'item-images');

CREATE POLICY "Users can delete own item images" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'item-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );
