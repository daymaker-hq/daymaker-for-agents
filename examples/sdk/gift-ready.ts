// Who has a gift ready, and what would sending them a gift link cost?
// Reads only: nothing is sent, and no credits are used.
//
// In this repository, build the SDK once, then run it:
//   npm ci && npm run build
//   DAYMAKER_KEY=dmk_live_... npx tsx examples/sdk/gift-ready.ts
// In your own project, `npm install @daymaker/sdk` is all it needs.
import { DaymakerClient, isDaymakerError } from "@daymaker/sdk";

const dm = new DaymakerClient(); // reads DAYMAKER_KEY

try {
  const me = await dm.getMe();
  console.log(`Signed in as ${me.you?.email} (${me.you?.role}), credits: ${me.credits?.balance}`);

  // Every campaign, page by page.
  for await (const page of dm.pages("listCampaigns", { limit: 100 })) {
    for (const campaign of page.campaigns) {
      // The people in this campaign whose gift is picked and ready.
      const { leads } = await dm.listLeads({ campaign_id: campaign.campaign_id, tab: "gift_ready", limit: 50 });
      if (!leads.length) continue;

      // A price check sends nothing and charges nothing.
      const { quote } = await dm.quoteGiftLinks({
        campaign_id: campaign.campaign_id,
        leads: leads.map((lead) => ({ lead_id: lead.lead_id, how: "share_link" as const })),
      });
      console.log(`${campaign.name}: ${leads.length} ready, $${quote.total_if_all_claimed_usd ?? 0} if everyone claims`);
      for (const line of quote.lines ?? []) console.log(`  ${line.lead_id}: ${line.gift} ($${line.if_claimed_usd})`);
    }
  }
} catch (err) {
  if (!isDaymakerError(err)) throw err;
  // Branch on status and code; the message is for people.
  console.error(`${err.status ?? ""} ${err.code}: ${err.message} (request ${err.requestId ?? "unknown"})`);
  process.exitCode = 1;
}
