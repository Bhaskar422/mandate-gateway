import { boolean, integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { Decision } from "../policy";
import type { MandateRules } from "../rules";
import type { ProductSnapshot } from "../product";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export type UserSettings = {
  /** Accept a merchant's partial-refund offer automatically when it is at least this share of the price (0-100). 100 means always ask. */
  autoAcceptRefundPercent?: number;
  /** Accept a replacement offer automatically. */
  autoAcceptReplacement?: boolean;
  /** A webhook (Slack, Discord, ntfy, or your own) the gateway posts to when something needs you. */
  notifyUrl?: string | null;
  /** Reserve the money at purchase and charge it only when the store ships, at stores that support it. */
  chargeOnShipment?: boolean;
};

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  /** The kill switch: while set, every agent purchase is blocked. */
  frozenAt: ts("frozen_at"),
  settings: jsonb("settings").$type<UserSettings>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** The user's vaulted PayPal wallet. The agent never sees any of this. */
export const paypalLinks = pgTable("paypal_links", {
  userId: text("user_id").primaryKey().references(() => users.id),
  setupTokenId: text("setup_token_id"),
  vaultId: text("vault_id"),
  customerId: text("customer_id"),
  /** PayPal's id for the buyer's account. It identifies the user: linking the same PayPal account again restores this account. */
  payerId: text("payer_id"),
  payerEmail: text("payer_email"),
  /** True when this is the gateway's shared demo wallet, lent to a visitor who has no PayPal sandbox account. */
  isDemo: boolean("is_demo").notNull().default(false),
  status: text("status").$type<"pending" | "active">().notNull().default("pending"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const mandates = pgTable("mandates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name"),
  /** Agents this mandate applies to. Null means every agent of the user. */
  agentIds: jsonb("agent_ids").$type<string[] | null>(),
  sourceText: text("source_text").notNull(),
  rules: jsonb("rules").$type<MandateRules>().notNull(),
  rulesHash: text("rules_hash").notNull(),
  status: text("status").$type<"draft" | "active" | "revoked">().notNull().default("draft"),
  createdAt: ts("created_at").notNull().defaultNow(),
  confirmedAt: ts("confirmed_at"),
});

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
  pausedAt: ts("paused_at"),
  pauseReason: text("pause_reason"),
  lastSeenAt: ts("last_seen_at"),
  /** "assistant" for the shopping assistant built into the dashboard; null for agents the user connected. */
  kind: text("kind"),
});

/** Merchant registry. The payee always comes from here, never from the agent. */
export const merchants = pgTable("merchants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull().unique(),
  paypalMerchantId: text("paypal_merchant_id"),
  paypalEmail: text("paypal_email"),
  verified: boolean("verified").notNull().default(false),
  /** "builtin" merchants ship with the gateway; "onboarded" ones registered themselves by URL. */
  source: text("source").$type<"builtin" | "onboarded">().notNull().default("builtin"),
  /** Set once the merchant has proved control of its domain by publishing the token below. */
  domainVerifiedAt: ts("domain_verified_at"),
  verificationToken: text("verification_token"),
  ordersUrl: text("orders_url"),
  returnsUrl: text("returns_url"),
  registeredBy: text("registered_by"),
  /** The store can take a reserved (authorized) payment, tell the gateway when it ships, and release it on cancel. */
  supportsHold: boolean("supports_hold").notNull().default(false),
  /** Where the store publishes its products as JSON, for agents to search. */
  catalogUrl: text("catalog_url"),
  /** The Ed25519 public key (SPKI PEM) the store published. While set, the store's requests to the gateway must be signed with it. */
  signingKey: text("signing_key"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Request ids already used by stores that sign their requests, so a captured request cannot be sent a second time. */
export const storeRequestIds = pgTable("store_request_ids", {
  merchantId: text("merchant_id").notNull(),
  requestId: text("request_id").notNull(),
  seenAt: ts("seen_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.merchantId, t.requestId] })]);

export type PurchaseStatus =
  | "blocked" | "pending_approval" | "declined" | "paying" | "captured" | "payment_failed" | "authorized" | "cancelled"
  | "refund_requested" | "refunded" | "partially_refunded" | "disputed";

export const purchases = pgTable("purchases", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  mandateId: text("mandate_id").references(() => mandates.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  merchantId: text("merchant_id").references(() => merchants.id),
  status: text("status").$type<PurchaseStatus>().notNull(),
  productUrl: text("product_url").notNull(),
  product: jsonb("product").$type<ProductSnapshot | null>(),
  quantity: integer("quantity").notNull().default(1),
  amountCents: integer("amount_cents").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  userRequest: text("user_request").notNull(),
  agentReason: text("agent_reason"),
  decision: jsonb("decision").$type<Decision>().notNull(),
  paypalOrderId: text("paypal_order_id"),
  paypalCaptureId: text("paypal_capture_id"),
  /** Set while the money is reserved but not yet charged. */
  paypalAuthorizationId: text("paypal_authorization_id"),
  paypalRefundId: text("paypal_refund_id"),
  refundedCents: integer("refunded_cents").notNull().default(0),
  /** The unit price the agent said it saw. */
  expectedPriceCents: integer("expected_price_cents"),
  /** Lets an agent retry a request without buying twice. */
  idempotencyKey: text("idempotency_key"),
  /** A secret link the user can open to approve or decline without signing in to the dashboard. */
  approvalToken: text("approval_token"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type SettlementOffer = { id: string; type: "full_refund" | "partial_refund" | "replacement"; amountCents?: number; sku?: string; reason: string };
export type SettlementTurn = { by: "buyer_agent" | "merchant_agent" | "user"; action: "ask" | "offer" | "counter" | "accept" | "decline" | "refund"; offer?: SettlementOffer; note: string; at: string };

export const cases = pgTable("cases", {
  id: text("id").primaryKey(),
  purchaseId: text("purchase_id").notNull().references(() => purchases.id),
  userId: text("user_id").notNull().references(() => users.id),
  report: text("report").notNull(),
  status: text("status").$type<"open" | "refund_requested" | "offer_pending" | "refunded" | "settled" | "merchant_declined" | "disputed" | "closed">().notNull().default("open"),
  /** The negotiation between the buyer's and the merchant's agents, turn by turn. */
  transcript: jsonb("transcript").$type<SettlementTurn[]>(),
  /** An offer waiting for the user's decision. */
  pendingOffer: jsonb("pending_offer").$type<SettlementOffer | null>(),
  analysis: jsonb("analysis").$type<Record<string, unknown>>(),
  merchantResponse: jsonb("merchant_response").$type<Record<string, unknown>>(),
  paypalRefundId: text("paypal_refund_id"),
  paypalDisputeId: text("paypal_dispute_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Append-only, hash-chained, signed evidence ledger. */
export const ledger = pgTable("ledger", {
  seq: serial("seq").primaryKey(),
  userId: text("user_id").notNull(),
  purchaseId: text("purchase_id"),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  at: text("at").notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
  signature: text("signature").notNull(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  resource: jsonb("resource").$type<Record<string, unknown>>().notNull(),
  verified: boolean("verified").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** The demo stores' own order book (the merchant's system, not the gateway's). */
export const storeOrders = pgTable("store_orders", {
  id: text("id").primaryKey(),
  storeSlug: text("store_slug").notNull(),
  gatewayPurchaseId: text("gateway_purchase_id").notNull(),
  paypalOrderId: text("paypal_order_id"),
  paypalCaptureId: text("paypal_capture_id"),
  authorizationId: text("authorization_id"),
  sku: text("sku").notNull(),
  shippedSku: text("shipped_sku"),
  tracking: text("tracking"),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").$type<"paid" | "held" | "shipped" | "refunded" | "cancelled">().notNull().default("paid"),
  paypalRefundId: text("paypal_refund_id"),
  disputeId: text("dispute_id"),
  disputeStatus: text("dispute_status"),
  note: text("note"),
  /** An offer this store has made and is holding open. */
  offer: jsonb("offer").$type<SettlementOffer | null>(),
  replacementSku: text("replacement_sku"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** What a demo store has published on its own site (stands in for the merchant editing its website). */
export const storeSettings = pgTable("store_settings", {
  slug: text("slug").primaryKey(),
  verificationToken: text("verification_token"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** How many messages a user has sent the built-in shopping assistant on a given UTC day. It runs on the gateway's model key, so it is capped. */
export const assistantUsage = pgTable("assistant_usage", {
  userId: text("user_id").notNull().references(() => users.id),
  day: text("day").notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.day] })]);

/** Deployment-wide settings the operator controls, such as which wallet is lent out as the demo wallet. */
export const gatewaySettings = pgTable("gateway_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * A browser that did not register a store can still ask to manage it. It gets its own token, and becomes the
 * store's registrant once that token appears in the store's published file. One row per store and browser, so
 * nobody can invalidate anyone else's token.
 */
export const merchantClaims = pgTable("merchant_claims", {
  merchantId: text("merchant_id").notNull().references(() => merchants.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  token: text("token").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.merchantId, t.userId] })]);
