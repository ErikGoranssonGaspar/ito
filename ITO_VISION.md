# Vision

## What this is

A minimal experiment toward an **AI-enabled workspace for applied mathematics and quantitative research**.

The goal is not to build an autonomous "AI researcher." The goal is to make existing frontier models fit naturally into the way researchers actually work.

The motivating analogy is something between **MATLAB and VS Code for AI-assisted research**: an environment that understands the basic objects and workflows of mathematical research, while remaining extensible and delegating AI work to existing model/harness infrastructure.

For the initial proof of concept, fork **T3 Code** rather than building a new application or agent harness from scratch.

## Design philosophy

### The researcher stays in the loop

AI should work *with* the researcher rather than attempt an end-to-end replacement.

Research is exploratory and poorly specified. Early work often consists of:

- asking questions while reading;
- trying mathematical ideas;
- checking whether an argument is plausible;
- quickly implementing numerical experiments;
- exploring data;
- finding relevant literature;
- moving between equations, papers, notes, and code.

Do not prematurely impose rigid structures such as theorem dependency DAGs, research plans, or autonomous multi-agent workflows. Structure can emerge later once the research itself becomes clearer.

### Optimize the workspace, not the model

Assume that frontier models and coding harnesses will continue changing rapidly.

Do **not** build a specialized mathematical model or recreate Claude Code/Codex/OpenCode-style agent infrastructure unless necessary. Instead, build a thin research-oriented layer around good existing harnesses.

The durable value should be in:

- interface design;
- mathematical rendering;
- context management;
- research-specific tools;
- interoperability;
- integrations;
- workflow ergonomics.

Ideally the underlying model or coding harness can be swapped as the frontier changes.

### Research objects should be first-class

For an applied mathematician, the important objects are things like:

- equations and mathematical notation;
- Markdown/LaTeX documents;
- papers and citations;
- personal research notes;
- Python code;
- notebooks;
- datasets and figures.

The application should treat these as naturally as a coding IDE treats source files.

## Important workflows

### 1. Mathematical chat

Provide a basic model conversation interface suitable for technical mathematical discussion.

**Correct LaTeX rendering is a baseline requirement**, not an optional enhancement.

This is probably the best first modification to the T3 Code fork.

### 2. Coding and computational experiments

Keep the strengths of existing coding agents.

For mathematical/data-science work, provide good ergonomics around notebook-style exploratory computation.

**Marimo** is particularly attractive because notebooks are represented as ordinary Python source files and are therefore relatively agent-friendly.

The eventual experience might allow the researcher to work on a Marimo notebook while an existing coding harness edits, runs, and reasons about it.

### 3. Research context

Code should not have to live in the same directory as notes merely so an agent can see both.

A project should eventually be able to reference several context sources, for example:

- a code repository;
- an Obsidian/Markdown vault;
- a reference library;
- selected papers;
- datasets.

During onboarding or project setup, the user could describe where these resources live and how they are organized.

The interface could then support lightweight attachment syntax such as:

`@note`
`@paper`
`@project`
`@file`

The principle is **selective contextualization**, rather than dumping an entire personal knowledge base into the model context.

### 4. Literature retrieval and citations

AI is particularly useful as a sophisticated scholarly search interface for targeted questions:

- "What is the standard reference for this method?"
- "Has anyone proved this result under weaker assumptions?"
- "Where does this approximation come from?"
- "Find papers using this model in finance."

Broad autonomous literature reviews are much less important.

Integrate scholarly search/repository APIs or MCP services where useful.

References returned by the model should resolve to real bibliographic objects. Ideally every citation can expose:

- title;
- authors;
- year;
- DOI or other stable identifier;
- clickable source;
- BibTeX.

A citation could render inline while its complete bibliographic information appears in a sidebar.

A lightweight critic/verifier pass that checks references and links before presenting them would be valuable.

**Reliability matters more than elaborate autonomous literature synthesis.**

### 5. Existing research ecosystems

Avoid forcing researchers to migrate their existing systems.

Prefer open standards and adapters:

- Markdown / Obsidian;
- BibTeX / Zotero;
- Python;
- Marimo;
- LaTeX;
- Lean where appropriate.

Different researchers organize their work differently, so integrations should be configurable rather than assuming one canonical workflow.

## Initial proof of concept

Do not attempt to implement the entire vision.

Start by forking T3 Code and preserve its existing architecture and upstream compatibility as much as possible.

### First milestone

Make T3 Code genuinely pleasant for mathematical conversation.

Specifically:

1. Fork T3 Code.
2. Understand its chat rendering architecture.
3. Add robust inline and display LaTeX rendering.
4. Ensure ordinary Markdown and code blocks continue working correctly.
5. Keep the implementation small enough that upstream T3 changes remain reasonably easy to merge.
6. Use the modified application for actual mathematical work and identify the next source of friction.

Possible later experiments include:

- Marimo integration;
- `@note` / `@paper` attachments;
- configurable external research-context sources;
- Obsidian/Markdown search;
- Zotero/BibTeX integration;
- scholarly search with stable DOI resolution;
- citation verification.

Do not implement these merely because they appear in this document. The immediate goal is to learn from using the smallest useful modification.

## Non-goals

At this stage, do not:

- build a new foundation model;
- build a specialized mathematics model;
- recreate an existing coding-agent harness;
- build an autonomous end-to-end research agent;
- build elaborate multi-agent orchestration;
- prescribe a rigid research workflow;
- build a comprehensive knowledge-management system;
- attempt to solve every research discipline's needs.

## Guiding criterion

The application succeeds when the researcher spends **less time managing the AI and moving information between tools, and more time doing research**.

The AI should increasingly feel like part of the workspace rather than another application that the researcher must operate.
