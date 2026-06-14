CREATE TABLE image_tags (
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (image_id, tag),
  CONSTRAINT image_tags_tag_not_blank CHECK (LENGTH(TRIM(tag)) > 0)
);

CREATE INDEX idx_image_tags_tag ON image_tags (LOWER(tag));
