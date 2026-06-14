import { useAuth } from "@frontend/auth/context/AuthContext";
import { PhotoData } from "@frontend/api-client";
import {
  getPhoto,
  suggestImageTags,
  updatePhotoTags,
} from "@frontend/api-client/services/photosService";
import { Button } from "@frontend/ui/components/ui/button";
import { Input } from "@frontend/ui/components/ui/input";
import { Check, Plus, Sparkles, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

const normalizeTag = (tag: string) => tag.trim().toLowerCase();

const ImageTags = () => {
  const { imageId } = useParams();
  const { isLoggedIn } = useAuth();
  const [photo, setPhoto] = useState<PhotoData | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadPhoto = async () => {
      if (!imageId) return;

      try {
        setLoading(true);
        const nextPhoto = await getPhoto(imageId);

        if (!cancelled) {
          setPhoto(nextPhoto);
          setTags(nextPhoto.tags);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Could not load image tags.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadPhoto();

    return () => {
      cancelled = true;
    };
  }, [imageId]);

  const sortedTags = useMemo(() => [...tags].sort(), [tags]);

  const addTag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalized = normalizeTag(newTag);
    if (!normalized) return;

    setTags((currentTags) =>
      currentTags.includes(normalized)
        ? currentTags
        : [...currentTags, normalized],
    );
    setNewTag("");
    setSaved(false);
  };

  const removeTag = (tagToRemove: string) => {
    setTags((currentTags) =>
      currentTags.filter((tag) => tag !== tagToRemove),
    );
    setSaved(false);
  };

  const saveTags = async () => {
    if (!imageId) return;

    try {
      setSaving(true);
      const savedTags = await updatePhotoTags(imageId, sortedTags);
      setTags(savedTags);
      setSaved(true);
      setError(null);
    } catch {
      setError("Could not save image tags.");
    } finally {
      setSaving(false);
    }
  };

  const getAiTags = async () => {
    if (!imageId) return;

    try {
      setSuggesting(true);
      const response = await suggestImageTags(imageId);
      setTags((currentTags) => {
        const mergedTags = new Set(currentTags);

        for (const tag of response.tags) {
          const normalized = normalizeTag(tag);
          if (normalized) mergedTags.add(normalized);
        }

        return Array.from(mergedTags);
      });
      setSaved(false);
      setError(null);
    } catch {
      setError("Could not get AI tags.");
    } finally {
      setSuggesting(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-5xl px-4">Loading...</div>;
  }

  if (!photo) {
    return (
      <div className="mx-auto max-w-5xl px-4">
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Image not found.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Image tags</h1>
          <p className="text-sm text-muted-foreground">{photo.title}</p>
        </div>
        <Button asChild variant="outline">
          <a href="/gallery">Back to gallery</a>
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <div className="overflow-hidden rounded-lg border bg-background">
          <img
            src={photo.small}
            alt={photo.title}
            className="aspect-square w-full object-cover"
          />
          <div className="space-y-1 p-3">
            <div className="font-medium">{photo.title}</div>
            {photo.description && (
              <div className="text-sm text-muted-foreground">
                {photo.description}
              </div>
            )}
            {photo.authorNickname && (
              <div className="text-sm text-muted-foreground">
                by {photo.authorNickname}
              </div>
            )}
          </div>
        </div>

        <section className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!isLoggedIn || suggesting}
              variant="secondary"
              onClick={getAiTags}
            >
              <Sparkles className="size-4" />
              {suggesting ? "Getting tags..." : "Get AI tags"}
            </Button>
            <Button
              type="button"
              disabled={!isLoggedIn || saving}
              onClick={saveTags}
            >
              <Check className="size-4" />
              {saving ? "Saving..." : "Update tags"}
            </Button>
          </div>

          <div className="min-h-56 rounded-lg border bg-white p-4 text-neutral-900 shadow-sm">
            {sortedTags.length === 0 ? (
              <div className="text-sm text-neutral-500">No tags saved.</div>
            ) : (
              <div className="flex flex-wrap items-start gap-2">
                {sortedTags.map((tag) => (
                  <span
                    key={tag}
                    className="relative inline-flex min-h-9 items-center rounded bg-neutral-200 py-2 pl-3 pr-7 text-sm text-neutral-900"
                  >
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      className="absolute right-1 top-1 rounded-sm p-0.5 text-neutral-600 hover:bg-neutral-300 hover:text-neutral-950"
                      onClick={() => removeTag(tag)}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <form className="flex gap-2" onSubmit={addTag}>
            <Input
              aria-label="Add tag"
              maxLength={40}
              placeholder="Add tag"
              value={newTag}
              onChange={(event) => setNewTag(event.target.value)}
            />
            <Button type="submit" variant="outline">
              <Plus className="size-4" />
              Add
            </Button>
          </form>

          {saved && (
            <div className="text-sm text-muted-foreground">Tags updated.</div>
          )}
          {!isLoggedIn && (
            <div className="text-sm text-muted-foreground">
              Sign in to update tags.
            </div>
          )}
          {error && <div className="text-sm text-destructive">{error}</div>}
        </section>
      </div>
    </div>
  );
};

export default ImageTags;
