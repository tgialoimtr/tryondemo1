CREATE TABLE IF NOT EXISTS public.try_ons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  person_image_id UUID,
  person_image_url TEXT NOT NULL,
  item_ids UUID[] DEFAULT '{}'::uuid[],
  item_images JSONB DEFAULT '[]'::jsonb,
  result_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.try_ons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own try ons"
ON public.try_ons
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own try ons"
ON public.try_ons
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own try ons"
ON public.try_ons
FOR DELETE
USING (auth.uid() = user_id);