import { z } from "zod";

export const PlatformSchema = z.enum(["facebook", "tiktok", "youtube"]);
export const WritePlatformSchema = z.enum(["facebook", "tiktok"]);

export const SourceItemSchema = z.object({
  source_platform: PlatformSchema,
  source_account: z.string(),
  source_item_id: z.string(),
  source_url: z.string().url(),
  published_at: z.string().datetime().optional(),
  title: z.string().default(""),
  caption_or_text: z.string().default(""),
  original_text: z.string().default(""),
  media_type: z.enum(["text", "image", "video", "link", "unknown"]).default("unknown"),
  media_urls: z.array(z.string().url()).default([]),
  thumbnail_url: z.string().url().optional(),
  author_name: z.string().optional(),
  raw: z.unknown().optional(),
});

export const ListNewRequestSchema = z.object({
  account: z.string().optional(),
  since_timestamp: z.string().datetime().optional(),
  limit: z.number().int().positive().max(2000).default(20),
  mark_seen: z.boolean().default(false),
});

export const GetItemRequestSchema = z.object({
  account: z.string().optional(),
  source_item_id: z.string().optional(),
  source_url: z.string().url().optional(),
});

export const PostRequestSchema = z.object({
  platform: WritePlatformSchema,
  text: z.string().min(1).max(2200),
  append_personal_comment: z.string().optional(),
  mediaUrls: z.array(z.string().url()).default([]),
  image_urls: z.array(z.string().url()).default([]),
  video_url: z.string().url().optional(),
  video_file: z.string().optional(),
  file_reference: z.string().optional(),
  linkUrl: z.string().url().optional(),
  scheduledAt: z.string().datetime().optional(),
  dryRun: z.boolean().default(false),
});

export type Platform = z.infer<typeof PlatformSchema>;
export type SourceItem = z.infer<typeof SourceItemSchema>;
export type ListNewRequest = z.infer<typeof ListNewRequestSchema>;
export type GetItemRequest = z.infer<typeof GetItemRequestSchema>;
export type PostRequest = z.infer<typeof PostRequestSchema>;

export type PublishResult = {
  platform: z.infer<typeof WritePlatformSchema>;
  ok: boolean;
  id?: string;
  url?: string;
  status?: string;
  raw?: unknown;
};

export type Publisher = {
  publish(request: PostRequest): Promise<PublishResult>;
  validate(): Promise<{ ok: boolean; message: string }>;
};

export type Reader = {
  listNew(request: ListNewRequest): Promise<SourceItem[]>;
  getItem(request: GetItemRequest): Promise<SourceItem>;
};