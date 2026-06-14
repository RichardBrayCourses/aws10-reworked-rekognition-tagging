export type PhotoData = {
  id: string;
  title: string;
  description: string;
  authorUserId: string;
  authorNickname: string | null;
  tags: string[];
  small: string;
  large: string;
  likedByCurrentUser?: boolean;
};

export type GetPhotosResponse = {
  photoData: PhotoData[];
};

export type TagSuggestionResponse = {
  imageId: string;
  tags: string[];
  source: "rekognition" | "fixture";
};
