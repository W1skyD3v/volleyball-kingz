import { z } from 'zod';
import { SCORING_MODES, TARGETS, TIERS, WIN_BYS } from './presets.js';

export const LaneSchema = z.enum(['casual', 'private', 'ranked']);
export const CourtTypeSchema = z.enum(['full', 'half', 'unknown']);
export const TierSchema = z.union(TIERS.map((t) => z.literal(t)) as unknown as [z.ZodLiteral<1>, z.ZodLiteral<2>, ...z.ZodLiteral<number>[]]);
export const TargetSchema = z.union(TARGETS.map((t) => z.literal(t)) as unknown as [z.ZodLiteral<7>, z.ZodLiteral<10>, ...z.ZodLiteral<number>[]]);
export const WinBySchema = z.union(WIN_BYS.map((t) => z.literal(t)) as unknown as [z.ZodLiteral<1>, z.ZodLiteral<2>]);
export const ScoringModeSchema = z.enum(SCORING_MODES);

export const CourtSchema = z.object({
  id: z.string(),
  osmType: z.enum(['node', 'way', 'relation']),
  osmId: z.number().int(),
  name: z.string().nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  courtType: CourtTypeSchema,
  hoops: z.number().int().nullable(),
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
