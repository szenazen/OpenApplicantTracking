---
prd_status: draft
---

# Product requirements (PRD)

<!--
  prd_status (YAML): pick one meaningful state (update after user confirms when changing metadata):

  not-started — Bootstrap default only. Treat as “no substantive requirements captured here yet”—not “agent must blindly draft”: see § How agents use this file.

  draft — Requirements are actively being negotiated or filled after user consent.

  active — Accepted as the working source of truth for product scope until superseded.

  external — Requirements document was supplied by the user (pasted elsewhere, imported, or materially authored outside agent drafts). Preserve content; align frontmatter after confirmation—not by silent rewrite.
-->

Single place for **what** we are building and **why**, separate from engineering task tracking (`.agent/tasks.json`) and project ops (`.agent/PROJECT.md`).

**Requirements source of truth:** Once substantive, **`prd.md` is canonical for product intent**—not chats, guesses, or ad-hoc task titles. **`planner`** and **`orchestrator`** (and anyone **adding or reprioritizing tasks**) should **re-read it routinely** before decomposing or sequencing work. **`engineer`**, **`architect`**, and **`reviewer`**: when product behavior or tradeoffs are **unclear or conflicting**, check **`prd.md` first**, then escalate to **`product`** (or ask the user) instead of imposing an unexplained interpretation.

## How agents use this file

1. **Substantive PRD already present** (real prose beyond boilerplate placeholders, user-authored or imported requirements): Treat as **authoritative**. **Do not** replace large sections silently. **Maintain** via small, agreed edits—**propose** changes (bullet delta or pasted snippet), get **explicit user confirmation**, then apply and append the **revision log**.
2. **User supplies PRD in chat / another path**: Offer to consolidate into **`prd.md`** (**`external`** or **`draft`**)—**integrate after confirmation**. Do not overwrite an existing substantive **`prd.md`** without consent.
3. **Only bootstrap boilerplate (`not-started` + placeholders) and breadth work planned**: Do **not** auto-fill from scratch unprompted. **Offer** a minimal draft; **pause for consent** (“fill PRD”, “defer”, spike-only”). After consent, **`product`** scaffolds to **`draft`** and iterates—unless the user already gave a delegated “go ahead” for creation in this thread.

Across all cases:

- **Scope/priority/feature changes** from conversation: summarize **proposed** PRD updates, ask apply **now** vs defer, then edit **`prd.md`** and **`.agent/PROJECT.md` / tasks** as needed once confirmed.
- **Stale frontmatter**: e.g. body is substantive but **`prd_status`** still **`not-started`** → suggest reconciling (**`draft`**, **`active`**, or **`external`**) via **minimal** frontmatter edits **after** user confirms.
- **Do not** let the PRD become a task diary; keep ongoing execution detail in **`tasks.json`** and **`HANDOFF.md`**.

## Product

# Objective

The objective of this challenge is to evaluate your capacity to design a new product from scratch.

# Challenge

Build a simple multi-tenant ATS (Applicant Tracking System) with multi-region hosting.

# Requirements

## **Product Requirements:**

- I would like to have an **Account** and invite multiple **Users** to collaborate on it.
- I would like to centralize all my recruitment data, including **job openings** and **candidates** in this **Account**.
- I would like to customize the statuses for each **Job opening**.
- I would like to track the **status** (e.g. Applied, Screening, HR Interview, Technical Interview, Offer, etc.) of the candidates in each **job opening** (see screenshot below) in this **Account**.
- I would like to be able to add a **candidate** to multiple **job openings**.
- I would like to store the **Skills** of each **Candidate** based on a pre-defined list of Skills stored in my database (e.g. table).

## **Technical Requirements:**

- We want the ATS to be a **multi-tenant** solution hosted in the cloud.
- We want to store each **Account’s** data (**Candidates** and **Job openings**) in the region of the client’s choice due to laws and regulations. (e.g. we want to start with 5 regions: us-east-1, eu-west-1, Singapore, Tokyo, Sydney)
- We want to allow the same **User** to access multiple **Accounts** using the same credentials (this includes the case where of a user having access to multiple accounts with data stored in multiple regions regions)
- We want certain data to be shared across regions (e.g. Skills should be the same in all regions)

## Example of use case:

Hays, an international recruitment agency, with 3 offices (1 in Europe, 1 in USA and 1 in Singapore) decided to use this ATS.

Each office is independent and does not share its data (candidate and job openings) with other offices.

Hays creates 3 **Accounts**: 1 **Account** for each office (each account data will be stored in the closest data center of our cloud provider - e.g. Hays Singapore will store its data in AWS Singapore region)

The CEO (a **User**) of Hays must be able to log in with the same credentials (e-mail, password) once and then switch from one **Account** to the other.

The experience of the CEO must be seamless. He only needs to use his credentials to access all the accounts.

# Deliverables

We would like you to prepare the following:

- **Data Structure Design:**
    
    Provide a visual diagram that illustrates the database schema and key relationships.
    
- **High-Level Architecture:**
    
    Deliver a visual diagram depicting the overall system architecture, including backend components and integrations.
    
- **API Contracts:**
    
    Define the structure of the API contracts with a specific focus on:
    
    - **Authentication & Authorization:** Detail how users register, log in, and securely access their accounts.
    - **Accounts, Candidates, and Job Pipelines:** Outline endpoints that manage user accounts, candidate data, and job pipelines (i.e., the ordered statuses for job openings).
- **Front-End Interaction & Responsiveness:**
    
    Explain how you will implement responsive, intuitive, and interactive features. Focus on the Job Pipeline:
    
    - **User Experience Enhancements**
    - **Interactive Features:** Detail the mechanisms (e.g., WebSockets, client-side frameworks) you will use to handle live data updates and interactive elements.
    

You can prepare your solution in the format of your choice. We strongly recommend having **visual support** to help you explain your solution (database diagram, draw.io, Miro or others).    

# Nomenclature

We recommend using the following terms in your presentation to identify the core objects:

- **User**: an individual with login credentials able to access one or multiple **Accounts**
- **Account**
- **Job Opening (or Job)**
- **Candidate**
- **Job Pipeline:** A set of ordered **statuses**
- **Statuses** (e.g. Shortlisted, HR Interview, Technical Evaluation, Offer, Final Interview, etc.)
- **Region:** refers to cloud provider’s region (in the context of AWS, us-east-1, eu-west-2, etc. are data centers called regions)
- **Multi-tenancy**

## Goals and non-goals


## System design

* Refer to the system designs in ./docs/adr/*.md
* Refer to the SOURCE OF TRUTH in `ATS-design.drawio.xml` as original design

## Revision log

| Date | Summary |
| --- | --- |
| *(ISO date)* | *(what changed in the PRD)* |
| 2026-05-05 | Set `prd_status` to **draft**: body carries substantive objectives and nomenclature; metadata aligned without changing scope. |
