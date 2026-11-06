import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Auth ──────────────────────────────────────────────
// Use a fixed redirect URL so Google always sends the user back
// to the correct host (Tailscale HTTPS) regardless of which device triggered login.
const APP_URL = 'https://loitg-ms-7d17.tail87f9af.ts.net';

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: APP_URL,
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}

// ── Storage ───────────────────────────────────────────
const PERSON_BUCKET = 'person-images';
const ITEM_BUCKET = 'item-images';

async function uploadImage(bucket, userId, file) {
  const ext = file.name.split('.').pop() || 'jpg';
  const fileName = `${userId}/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
  
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
    });
  
  if (error) throw error;
  
  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(data.path);
  
  return { path: data.path, url: urlData.publicUrl };
}

async function deleteImage(bucket, path) {
  const { error } = await supabase.storage
    .from(bucket)
    .remove([path]);
  if (error) throw error;
}

// ── Database ──────────────────────────────────────────
export async function addPersonImage(userId, file) {
  const { path, url } = await uploadImage(PERSON_BUCKET, userId, file);
  
  const { data, error } = await supabase
    .from('person_images')
    .insert({ user_id: userId, storage_path: path, image_url: url })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function getPersonImages(userId) {
  const { data, error } = await supabase
    .from('person_images')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data || [];
}

export async function deletePersonImage(id, storagePath) {
  await deleteImage(PERSON_BUCKET, storagePath);
  
  const { error } = await supabase
    .from('person_images')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
}

export async function addItemImage(userId, file) {
  const { path, url } = await uploadImage(ITEM_BUCKET, userId, file);
  
  const { data, error } = await supabase
    .from('item_images')
    .insert({ user_id: userId, storage_path: path, image_url: url })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function getItemImages(userId) {
  const { data, error } = await supabase
    .from('item_images')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data || [];
}

export async function deleteItemImage(id, storagePath) {
  await deleteImage(ITEM_BUCKET, storagePath);
  
  const { error } = await supabase
    .from('item_images')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
}

// ── Try Ons ─────────────────────────────────────────────
export async function addTryOn(userId, payload) {
  const { data, error } = await supabase
    .from('try_ons')
    .insert({
      user_id: userId,
      person_image_id: payload.person_image_id || null,
      person_image_url: payload.person_image_url || '',
      item_ids: payload.item_ids || [],
      item_images: payload.item_images || [],
      result_image_url: payload.result_image_url || '',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getTryOns(userId) {
  const { data, error } = await supabase
    .from('try_ons')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// ── Profile ───────────────────────────────────────────
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
  return data;
}

export async function upsertProfile(userId, shopName, address) {
  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      { user_id: userId, shop_name: shopName, address: address },
      { onConflict: 'user_id' }
    )
    .select()
    .single();
  
  if (error) throw error;
  return data;
}
