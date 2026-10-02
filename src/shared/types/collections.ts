/** A local, user-created list. Membership is independent of reading status and tags. */
export interface Collection {
  id: string;
  name: string;
  seriesIds: string[];
  createdAt: number;
  updatedAt: number;
}
