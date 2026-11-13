-- Same as alembic/versions/0003_image_versions.py, for running by hand in the Supabase SQL editor.
ALTER TABLE content_versions DROP CONSTRAINT ck_content_versions_source_valid;
ALTER TABLE content_versions ADD CONSTRAINT ck_content_versions_source_valid
  CHECK (source IN ('paste', 'upload', 'suggestion', 'manual', 'image'));

CREATE TABLE version_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL UNIQUE REFERENCES content_versions(id),
  mime text NOT NULL, width int NOT NULL, height int NOT NULL, sha256 text NOT NULL,
  platform text, data bytea NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  regions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER version_images_no_change BEFORE UPDATE OR DELETE ON version_images
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Record the migration, so Render's automatic "alembic upgrade head" does not run it a second time.
UPDATE alembic_version SET version_num = '0003';
