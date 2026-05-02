export interface FetchedItem {
  externalId: string;
  url: string;
  title: string;
  author?: string;
  publishedAt?: Date;
  imageUrl?: string;
  contentHtml?: string;
  contentText?: string;
}

export interface FetchResult {
  items: FetchedItem[];
  sourceTitle?: string;
  etag?: string;
  lastModified?: string;
  notModified?: boolean;
}

export interface FetcherCtx {
  url: string;
  etag?: string | null;
  lastModified?: string | null;
}

export type Fetcher = (ctx: FetcherCtx) => Promise<FetchResult>;
