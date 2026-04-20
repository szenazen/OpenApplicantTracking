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