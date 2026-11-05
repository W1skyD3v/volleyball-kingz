import { z } from 'zod';
import { BEST_OFS, COURT_TYPES, TARGETS, TIERS, WIN_BYS } from './presets.js';
import { POINT_TAGS } from './scoring.js';

export const LaneSchema = z.enum(['casual', 'private', 'ranked']);
export const CourtTypeSchema = z.enum(COURT_TYPES);
const literalUnion = <T extends number>(xs: readonly T[]) => z.union(xs.map((x) => z.literal(x)) as unknown as [z.ZodLiteral<T>, z.ZodLiteral<T>, ...z.ZodLiteral<T>[]]);
export const TierSchema = literalUnion(TIERS);
export const TargetSchema = literalUnion(TARGETS);
export const WinBySchema = literalUnion(WIN_BYS);
export const BestOfSchema = literalUnion(BEST_OFS);
export const PointTagSchema = z.enum(POINT_TAGS);

export const CourtSchema = z.object({
  id: z.string(),
  osmType: z.enum(['node', 'way', 'relation']),
  osmId: z.number().int(),
  name: z.string().nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  courtType: CourtTypeSchema,
  nets: z.number().int().nullable(),
  areaM2: z.number().nullable(),
  access: z.string().nullable(),
});
export type Court = z.infer<typeof CourtSchema>;

export const ProfileSchema = z.object({
  id: z.string(),
  displayName: z.string().min(2).max(24),
  birthYear: z.number().int().min(1900).max(2100),
  isMinor: z.boolean(),
  casualEloOptIn: z.boolean().default(false),
  avatar: z.unknown().optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const CheckInInputSchema = z.object({
  courtId: z.string(),
  lat: z.number(),
  lng: z.number(),
  accuracyM: z.number().nullable().optional(),
});

export const RunInputSchema = z.object({
  courtId: z.string(),
  startsAt: z.string().datetime(),
  tier: TierSchema,
  lane: LaneSchema,
  presetId: z.string(),
  note: z.string().max(200).optional(),
});

export const REPORT_REASONS = ['harassment', 'unsafe', 'cheating', 'spam', 'inappropriate', 'other'] as const;
export const ReportInputSchema = z.object({
  targetType: z.enum(['post', 'user', 'game', 'run', 'court']),
  targetId: z.string(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().max(1000).optional(),
  /** Hidden alert button after a game: routes to a human reviewer. */
  safetyEscalation: z.boolean().default(false),
});
export type ReportInput = z.infer<typeof ReportInputSchema>;

export const PostGameFeedbackSchema = z.object({
  gameId: z.string(),
  gameRating: z.number().int().min(1).max(5),
  playerRatings: z.array(z.object({ userId: z.string(), stars: z.number().int().min(1).max(5) })),
});
