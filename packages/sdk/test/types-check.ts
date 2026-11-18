// Compile-time checks: this file is type-checked, never run.
import { DaymakerClient, type OperationInput, type OperationOutput, type PagedOperationId } from "../src/index.js";

declare const dm: DaymakerClient;

// A required path field.
const g: OperationInput<"getLead"> = { lead_id: "l1" };
// @ts-expect-error lead_id is required
const bad: OperationInput<"getLead"> = {};
void g;
void bad;

// Lists page; a single read does not.
const paged: PagedOperationId = "listLeads";
// @ts-expect-error getMe has no offset
const notPaged: PagedOperationId = "getMe";
void paged;
void notPaged;

async function probe() {
  await dm.getMe();
  const leads: OperationOutput<"listLeads"> = await dm.listLeads({ tab: "gift_ready", limit: 10 });
  const id: string = leads.leads[0]!.lead_id;
  // A field with nothing in it is left out of an answer, so every field may be missing.
  const next: number | null | undefined = leads.next_offset;

  // @ts-expect-error a tab the API does not have
  await dm.listLeads({ tab: "everyone" });
  // @ts-expect-error a read takes no idempotency key
  await dm.listLeads({ idempotency_key: "k" });
  // @ts-expect-error a price check takes no idempotency key
  await dm.quoteGiftLinks({ campaign_id: "c1", leads: [{ lead_id: "l1", how: "share_link" }], idempotency_key: "k" });

  await dm.researchLead({ lead_id: "l1", max_credits: 38, idempotency_key: "k" });
  await dm.setGiftMessage({ lead_id: "l1", body: "Hello" });
  // @ts-expect-error the note needs its words
  await dm.setGiftMessage({ lead_id: "l1" });

  // The revision sits inside the answer's `quote`. The answer is an open object, so a typed
  // assignment (not String(...)) is what proves the field is where the contract puts it.
  const { quote } = await dm.quoteGiftLinks({ campaign_id: "c1", leads: [{ lead_id: "l1", how: "email_link" }] });
  const revision: string | undefined = quote.quote_revision;
  const claimedTotal: number | undefined = quote.total_if_all_claimed_usd;
  await dm.sendGiftLinks({
    campaign_id: "c1",
    leads: [{ lead_id: "l1", how: "email_link" }],
    quote_revision: revision!,
  });
  const checkout = await dm.quoteCheckout({ campaign_id: "c1", leads: [{ lead_id: "l1" }] });
  const total: number | undefined = checkout.quote.total_usd;
  const reach = await dm.quoteReachOut({ campaign_id: "c1", leads: [{ lead_id: "l1" }] });
  const reachTotal: number | undefined = reach.total_if_all_say_yes_usd;
  void [claimedTotal, total, reachTotal];
  // @ts-expect-error a send needs the quote it was priced with
  await dm.sendGiftLinks({ campaign_id: "c1", leads: [{ lead_id: "l1", how: "email_link" }] });
  // @ts-expect-error a way to send that does not exist
  await dm.sendGiftLinks({ campaign_id: "c1", leads: [{ lead_id: "l1", how: "carrier_pigeon" }], quote_revision: "x" });

  for await (const page of dm.pages("listCampaigns", { limit: 100 })) void page.total;
  return [id, next];
}
void probe;
