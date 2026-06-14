import {
  DetectLabelsCommand,
  RekognitionClient,
} from "@aws-sdk/client-rekognition";

const rekognitionClient = new RekognitionClient();

export type TagSuggestionSource = "rekognition" | "fixture";

export type TagSuggestionResult = {
  tags: string[];
  source: TagSuggestionSource;
};

export async function suggestImageTags(photo: {
  uuid_filename: string;
  image_name: string;
  image_description: string | null;
}): Promise<TagSuggestionResult> {
  if (process.env.PHOTOS_TAG_SUGGESTION_MODE === "fixture") {
    return {
      tags: buildFixtureTagSuggestions(photo),
      source: "fixture",
    };
  }

  const bucketName = process.env.IMAGES_BUCKET_NAME;

  if (!bucketName) {
    throw new Error("IMAGES_BUCKET_NAME is not configured.");
  }

  const response = await rekognitionClient.send(
    new DetectLabelsCommand({
      Image: {
        S3Object: {
          Bucket: bucketName,
          Name: photo.uuid_filename,
        },
      },
      MaxLabels: 20,
      MinConfidence: 75,
    }),
  );

  return {
    tags: normalizeTags(
      (response.Labels ?? [])
        .map((label) => label.Name)
        .filter((name): name is string => Boolean(name)),
    ),
    source: "rekognition",
  };
}

function buildFixtureTagSuggestions(photo: {
  image_name: string;
  image_description: string | null;
}) {
  const fixtureVocabulary = [
    "landscape",
    "outdoors",
    "travel",
    "nature",
    "light",
    "composition",
    "colour",
    "texture",
  ];
  const sourceWords = [photo.image_name, photo.image_description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);

  return normalizeTags([...sourceWords, ...fixtureVocabulary]).slice(0, 12);
}

function normalizeTags(tags: string[]) {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0 && tag.length <= 40),
    ),
  ).slice(0, 20);
}
