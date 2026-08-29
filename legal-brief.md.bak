# Groovework — brief for legal advisers

Prepared 2026-08-04. **Not legal advice** — this is a list of questions to put to
professionals, plus the facts they'll need to answer them.

## Who you need (two different professionals)

| Work | Who |
|---|---|
| Trade mark clearance, filing, patent question | **Registered trade marks / patent attorney** (IP Australia registered) |
| Company structure, IP assignment, ToS, privacy policy | **Commercial solicitor** |

These are separate professions in Australia. A general commercial solicitor cannot
file a trade mark. Ask the accountant for both referrals, or ask the solicitor to
refer you to an attorney they work with.

---

## PART A — Trade mark attorney

### The facts to hand them

- Proposed mark: **GROOVEWORK** (word mark)
- Product: work-management software for property/grounds/site operations. Web app now,
  iOS app from ~Sept 2026. Subscription, ~A$19/mo solo, ~A$12/seat teams.
- Classes likely needed: **9** (software) and **42** (SaaS). Ask whether **35**
  (business management services) is also warranted.
- Market: Australia first, App Store is global from day one.

### Known obstacles (found 2026-08-04, preliminary searches only)

1. **Microsoft — GROOVE, AU TM 855034.** Live to 2030, registered in **classes 9 and 42**
   — the exact classes needed. This is the main question.
2. **GROOVE WORKS AUST PTY LTD**, ACN 110 641 579, ABN 60 110 641 579, active since
   23 Aug 2004, VIC 3831. Audiophile / record-cleaning equipment (class 9 goods).
   **Trades publicly as "Record Clean"** — no registered business names on the ABN record.
   No trade mark registration found.
3. **GROOVEWORKS MUSIC**, ABN 60 122 464 124, a business name (not a company), QLD 4053.
   No trade mark registration found.
4. `groovework.com` is taken (email-active since 2013, US). `.com.au` and `.au` were free
   as at 2026-08-04.

### Questions

1. **Can GROOVEWORK be registered in classes 9 and 42 in Australia given Microsoft's live
   GROOVE registration in the same classes?** What's the realistic likelihood of an
   examiner's adverse report on s44 (deceptively similar to an earlier mark)?
2. If it's likely to be refused, **what is the cheapest fix?** Specifically:
   - a composite/logo mark rather than the plain word?
   - a narrower goods/services specification that avoids Microsoft's?
   - a letter of consent or coexistence agreement — is that realistic with Microsoft?
   - a different word entirely, and if so how much lead time do I need?
3. **Do the two prior users (Groove Works Aust, Grooveworks Music) create a real risk** of
   opposition, passing off, or an Australian Consumer Law misleading-conduct claim — given
   neither holds a registration, neither is in my market, and one doesn't trade under the
   name publicly?
4. **File now or wait?** What does it cost me to file and be refused, versus the cost of
   rebranding after the App Store listing is live?
5. **What is the deadline that actually binds me?** My iOS bundle ID and App Store listing
   are effectively permanent once published (target: late Sept 2026). Should the mark be
   settled before then?
6. **International:** the App Store publishes globally. Do I need US or Madrid Protocol
   filings, and when? What's my exposure trading under an unregistered mark overseas?
7. **If GROOVEWORK is unsafe, can you clear 2–3 alternatives quickly?** I would rather
   change now than in October.

### The patent question — TIME CRITICAL

The core of the product is an engine that **learns how long each task takes from the
sequence and timing of completed work**, then auto-estimates future jobs and reorders task
lists from observed behaviour. No competitor found in a ~36-product scan closes that loop.

8. **Is any of that patentable in Australia**, given the case law on software and business
   methods (Encompass, Rokt)? Honest assessment — I'd rather hear "no" cheaply than pay to
   find out.
9. **How long is left on my disclosure grace period?** Dates, from git history rather than
   memory:
   - **31 May 2026** — first commit, first push to a **public** GitHub repository. The
     source has been publicly readable from this date. This is the earliest defensible
     disclosure date.
   - **5 July 2026** — GitHub Pages deploy workflow created; the app served publicly at a
     public URL.
   - **4 Aug 2026** — repository switched to private. The served app remains public.

   Australia and the US both provide a 12-month grace period for the applicant's own
   disclosure, which on the earliest date would run to **~31 May 2027**. Questions:
   **(a)** does publishing source to a public repository count as an enabling disclosure
   that starts the clock, or does the clock start when the app was served at 5 July?
   **(b)** confirm the deadline; **(c)** does the grace period apply in every jurisdiction
   I'd care about, or only AU/US?
10. Is a **provisional application** worth filing as a cheap placeholder, or is that money
    better spent elsewhere?

---

## PART B — Commercial solicitor

### Company and IP ownership

11. **Groovework Pty Ltd** is being registered (Aug 2026). Should the IP — source code,
    trade mark, domains — be **assigned to the company from day one**, and what document
    does that?
12. **⚠️ Who owns the code today?** This matters and I need it resolved cleanly:
    - The app began as an internal tool for **Kaiser Ridge Pty Ltd**, originally named
      `kaiser-ridge-task-tracker`, and is still used to run that business daily.
    - I also operate the **LK & NC Grocke Partnership**.
    - I wrote it myself, unpaid, outside any employment contract.
    - **Could Kaiser Ridge Pty Ltd or the partnership have any claim to the IP?** If so,
      what deed of assignment do I need before I take investment, sell seats, or file a
      trade mark in the new company's name?
13. Should IP sit in a **separate holding entity** from the trading company, or is that
    over-engineering at this stage?

### Privacy — Australian Privacy Act

14. As a small business, am I **exempt from the Australian Privacy Principles** under the
    <$3m turnover threshold — and does the exemption survive once I'm selling a SaaS that
    stores other businesses' operational data? Should I comply voluntarily regardless?
15. **Notifiable Data Breaches scheme** — what are my obligations, and what do I need in
    place *before* the first paying customer?
16. **Third-party processors I must disclose:**
    - **Supabase** — database and authentication, hosted in **Sydney (ap-southeast-2)**.
    - **Anthropic** — the onboarding assistant sends user-supplied job and task
      descriptions to a third-party AI model for processing.
    - **Apple** — payments and subscriptions via App Store IAP.
    - **Google** — sign-in (email address only), and Calendar/Drive for existing users.
    What must the privacy policy say about each?
17. **APP 8 / cross-border disclosure** — data is stored in Australia, but the AI
    processing may occur overseas. What does that require of me?

### Terms of service

18. I need a **ToS and privacy policy** fit for both a web app and the App Store. Can you
    draft, or review a draft?
19. **Australian Consumer Law:** consumer guarantees can't be excluded. How do I limit
    liability as far as is lawful — particularly for **data loss**, since the accumulated
    work history *is* the product's value to the customer?
20. **Subscription terms:** 14-day free trial converting to a paid auto-renewing
    subscription. What does ACL require on disclosure, cancellation and renewal notices?
    Does Apple handling the billing cover me, or do I still carry obligations?
21. **Data ownership and exit:** the customer owns their data. What must I commit to on
    export and deletion when they cancel?
22. **Closed beta (~15–25 users, from Sept 2026):** do I need a separate beta agreement or
    disclaimer covering the higher risk of data loss during beta?

### Employment and contractors

23. If I engage **employees or contractors** at Kaiser Ridge who use the app, or ever hire
    a developer — what IP assignment and confidentiality clauses do I need in those
    contracts as standard?

### Insurance (may be a broker question, but ask)

24. What cover does my ToS assume I have — **cyber liability**, **professional indemnity** —
    and at what point do I need it in place?

---

## Priority order

| Urgency | Item |
|---|---|
| **Now** | Q9 — patent disclosure clock. If it's run, it's run; I need to know. |
| **Before Apple enrolment (~Sept)** | Q1–Q7 — the mark must be settled before the bundle ID and listing are permanent. |
| **Before the company holds anything** | Q11–Q12 — IP assignment, and the Kaiser Ridge ownership question. |
| **Before the first beta user** | Q14–Q22 — privacy policy, ToS, beta disclaimer. |
| **Before the first paying customer** | Q24 — insurance in force. |
