import { Ban, CalendarClock, CalendarDays, Hand, Hash, ShoppingBasket, Store, Tag, Wallet } from "lucide-react";
import { ALWAYS_BLOCKED, type MandateRules } from "@/lib/rules";
import { MERCHANT_POLICY, money } from "../format";
import LocalTime from "../LocalTime";

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5">
      <span className="mt-0.5 shrink-0 text-ink-3">{icon}</span>
      <dt className="w-28 shrink-0 text-sm text-ink-3 sm:w-36">{label}</dt>
      <dd className="min-w-0 flex-1 text-base text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
const Chips = ({ items }: { items: string[] }) => <span className="flex flex-wrap gap-1.5">{items.map((c) => <span key={c} className="rounded-md border border-line bg-raised px-2 py-0.5 text-sm">{c}</span>)}</span>;

/** The compiled rules of a mandate, one per line, in the words a buyer would use. These are what the code enforces. */
export default function RulesList({ rules }: { rules: MandateRules }) {
  const cur = rules.currency;
  const named = rules.allowedCategories.join(" ").toLowerCase();
  const stillBlocked = ALWAYS_BLOCKED.filter((c) => !named.includes(c.replace(/s$/, "")));
  return (
    <dl className="divide-y divide-line">
      <Row icon={<Wallet size={16} aria-hidden />} label="Total budget"><span className="num font-semibold">{money(rules.totalLimitCents, cur)}</span></Row>
      <Row icon={<Tag size={16} aria-hidden />} label="Per purchase">{rules.perPurchaseLimitCents === null ? <span className="text-ink-2">No separate limit</span> : <span className="num">Up to {money(rules.perPurchaseLimitCents, cur)}</span>}</Row>
      {rules.dailyLimitCents != null && <Row icon={<CalendarDays size={16} aria-hidden />} label="Per day"><span className="num">Up to {money(rules.dailyLimitCents, cur)}</span></Row>}
      {rules.perMerchantLimitCents != null && <Row icon={<Store size={16} aria-hidden />} label="Per store"><span className="num">Up to {money(rules.perMerchantLimitCents, cur)}</span></Row>}
      <Row icon={<Hand size={16} aria-hidden />} label="Ask me first">
        {rules.approvalThresholdCents === null ? <span className="text-ink-2">Never: anything inside the limits is paid without asking</span>
          : rules.approvalThresholdCents === 0 ? "Always, before every purchase" : <span className="num">For anything above {money(rules.approvalThresholdCents, cur)}</span>}
      </Row>
      <Row icon={<ShoppingBasket size={16} aria-hidden />} label="May buy"><Chips items={rules.allowedCategories} /></Row>
      <Row icon={<Store size={16} aria-hidden />} label="Stores">
        {MERCHANT_POLICY[rules.merchantPolicy] ?? rules.merchantPolicy}
        {rules.merchantPolicy === "allowlist" && rules.allowedMerchants.length > 0 && <span className="mt-1.5 block"><Chips items={rules.allowedMerchants} /></span>}
      </Row>
      {rules.blockedMerchants.length > 0 && <Row icon={<Ban size={16} aria-hidden />} label="Never buy from"><Chips items={rules.blockedMerchants} /></Row>}
      {rules.maxPurchases !== null && <Row icon={<Hash size={16} aria-hidden />} label="Purchases"><span className="num">At most {rules.maxPurchases}</span></Row>}
      <Row icon={<CalendarClock size={16} aria-hidden />} label="Ends"><LocalTime iso={rules.expiresAt} /></Row>
      {stillBlocked.length > 0 && <Row icon={<Ban size={16} aria-hidden />} label="Always blocked"><span className="text-ink-2">{stillBlocked.join(", ")}. These are how stolen money is cashed out, so they are blocked unless a mandate names them.</span></Row>}
    </dl>
  );
}
