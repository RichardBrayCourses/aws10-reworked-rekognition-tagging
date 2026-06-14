import { Router } from "express";
import {
  getAuthenticatedPhotos,
  getPhotoTagSuggestions,
  getPresignedUrl,
  togglePhotoLike,
  updatePhotoTags,
} from "../controllers/photoController";

export const photoRoutes = Router();

photoRoutes.get("/gallery", getAuthenticatedPhotos);
photoRoutes.post("/presigned-url", getPresignedUrl);
photoRoutes.post("/:imageId/like", togglePhotoLike);
photoRoutes.post("/:imageId/tag-suggestions", getPhotoTagSuggestions);
photoRoutes.put("/:imageId/tags", updatePhotoTags);
