import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { Decision } from "../policy";
import type { MandateRules } from "../rules";
import type { ProductSnapshot } from "../product";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** The user's vaulted PayPal wallet. The agent never sees any of this. */
export const paypalLinks = pgTable("paypal_links", {
  userId: text("user_id").primaryKey().references(() => users.id),
  setupTokenId: text("setup_token_id"),
  vaultId: text("vault_id"),
  customerId: text("customer_id"),
  payerEmail: text("payer_email"),
  status: text("status").$type<"pending" | "active">().notNull().default("pending"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const mandates = pgTable("mandates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
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
});

/** Merchant registry. The payee always comes from here, never from the agent. */
export const merchants = pgTable("merchants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull().unique(),
  paypalMerchantId: text("paypal_merchant_id"),
  paypalEmail: text("paypal_email"),
  verified: boolean("verified").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type PurchaseStatus =
  | "blocked" | "pending_approval" | "declined" | "paying" | "captured" | "payment_failed"
  | "refund_requested" | "refunded" | "disputed";

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
  paypalRefundId: text("paypal_refund_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const cases = pgTable("cases", {
  id: text("id").primaryKey(),
  purchaseId: text("purchase_id").notNull().references(() => purchases.id),
  userId: text("user_id").notNull().references(() => users.id),
  report: text("report").notNull(),
  status: text("status").$type<"open" | "refund_requested" | "refunded" | "merchant_declined" | "disputed" | "closed">().notNull().default("open"),
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
  sku: text("sku").notNull(),
  shippedSku: text("shipped_sku"),
  tracking: text("tracking"),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").$type<"paid" | "shipped" | "refunded">().notNull().default("paid"),
  paypalRefundId: text("paypal_refund_id"),
  disputeId: text("dispute_id"),
  disputeStatus: text("dispute_status"),
  note: text("note"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
