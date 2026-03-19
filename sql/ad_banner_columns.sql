-- Add banner image support columns to ad_placements table
ALTER TABLE ad_placements ADD COLUMN IF NOT EXISTS banner_image_url text;
ALTER TABLE ad_placements ADD COLUMN IF NOT EXISTS banner_link_url text;
ALTER TABLE ad_placements ADD COLUMN IF NOT EXISTS banner_size text DEFAULT 'medium';
ALTER TABLE ad_placements ADD COLUMN IF NOT EXISTS banner_alt text;
