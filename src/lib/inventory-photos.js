// v55.83-IJ — batch primary-photo lookup for inventory product lists.
//
// Product photos are INTERNAL-only: they live in the PRIVATE Supabase bucket
// "product-photos" and are shown through short-lived SIGNED URLs (see
// AttachmentManager isPrivate mode + sql/v55-83-II-product-photos.sql). List
// screens (Product Master, ProductPicker) can't store a stable URL, so they
// call this to mint a fresh batch of signed thumbnail URLs for the primary
// photo of each product currently on screen.
//
// Fully graceful: if the migration hasn't run (no is_primary column) or the
// private bucket doesn't exist yet, every Supabase call errors, we swallow it,
// and return an empty map — so list rows simply show no thumbnail, never crash.

import { supabase } from './supabase';

var PRODUCT_PHOTO_BUCKET = 'product-photos';

// loadPrimaryPhotoUrls(productIds) -> Promise<{ [productId]: signedUrl }>
// Only products that HAVE a primary photo appear in the returned map.
export async function loadPrimaryPhotoUrls(productIds) {
  var out = {};
  try {
    var ids = (productIds || []).filter(Boolean);
    if (!ids.length) { return out; }

    // 1. Find the primary photo's storage_path for each product.
    var res = await supabase
      .from('attachments')
      .select('parent_id, storage_path')
      .eq('parent_type', 'inventory_product')
      .eq('is_primary', true)
      .in('parent_id', ids);
    if (res.error || !res.data || !res.data.length) { return out; }

    // 2. Collect paths and remember which product each belongs to.
    var pathToProduct = {};
    var paths = [];
    res.data.forEach(function (row) {
      if (row && row.storage_path && row.parent_id) {
        pathToProduct[row.storage_path] = row.parent_id;
        paths.push(row.storage_path);
      }
    });
    if (!paths.length) { return out; }

    // 3. Mint signed URLs in one batch (1 hour expiry).
    var signed = await supabase.storage.from(PRODUCT_PHOTO_BUCKET).createSignedUrls(paths, 3600);
    if (signed && signed.data) {
      signed.data.forEach(function (s) {
        if (s && s.path && s.signedUrl && pathToProduct[s.path]) {
          out[pathToProduct[s.path]] = s.signedUrl;
        }
      });
    }
  } catch (e) {
    console.warn('[inventory-photos] loadPrimaryPhotoUrls failed:', e);
  }
  return out;
}
