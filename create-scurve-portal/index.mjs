#!/usr/bin/env node
/*
 * create-scurve-portal — scaffolds a conforming agent platform portal.
 *
 * `portal_ui_standards.md` section 9 step 6. The point is that portal four
 * inherits the standard by construction rather than by compliance: the three
 * existing portals converged on the same toolchain by accident and diverged on
 * everything above it, and a fourth would have inherited one of those three
 * precedents at random or invented a fourth.
 *
 * So the one question this asks is the one the standard says is genuinely
 * per-portal: which surface is primary. Section 5a records that the
 * interaction model should follow the shape of the task — causal is
 * conversation-first because causal analysis is a gated 14-stage workflow,
 * forecasting is workbench-first because it is iterative comparison,
 * predictive is dual-mode because artifact review wants both — and that
 * primary interaction model is explicitly *not* a conformance item.
 *
 * Everything that is a conformance item is not asked about, because there is
 * nothing to decide: the src/ layout of section 3, the kit API client of
 * section 4, kit tokens, kit primitives, TypeScript, and Vite with the
 * standard dev/build/preview scripts.
 *
 * Usage:
 *     npm create scurve-portal@latest -- --name experimentation
 *     node create-scurve-portal/index.mjs --name experimentation --surface conversation
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, 'template');

/** The kit tag a generated portal pins. Section 2: portals pin a tag. */
const KIT_VERSION = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version;

const SURFACES = {
  conversation: {
    label: 'conversation',
    blurb: 'a gated or sequential workflow, where the gating is the product',
    example: 'causal — 14 stages, several of which pause for human judgment',
    dual: false,
  },
  workbench: {
    label: 'workbench',
    blurb: 'iterative comparison and direct manipulation, with conversation as an assist',
    example: 'forecasting — run methods, compare a leaderboard, overlay scenarios',
    dual: false,
  },
  'dual-mode': {
    label: 'dual-mode',
    blurb: 'artifact review, where an operator needs both and switches explicitly',
    example: 'predictive — evidence packets and promotion gates',
    dual: true,
  },
};

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

function isValidName(name) {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

async function prompt(args) {
  const answers = { name: args.name, surface: args.surface };
  const needsInput = !answers.name || !SURFACES[answers.surface];
  if (!needsInput) return answers;

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (!isValidName(answers.name ?? '')) {
      answers.name = (
        await rl.question('Platform slug (lowercase, e.g. experimentation): ')
      ).trim();
      if (!isValidName(answers.name)) {
        console.log('  Lowercase letters, digits and hyphens, starting with a letter.');
      }
    }

    while (!SURFACES[answers.surface]) {
      console.log('\nWhich surface is primary?');
      console.log('  Section 5a: this follows the shape of the task, and it is the one');
      console.log('  thing here that is deliberately per-portal. It is not a conformance');
      console.log('  item — you are picking an interaction model, not a component library.\n');
      for (const [key, surface] of Object.entries(SURFACES)) {
        console.log(`  ${key.padEnd(13)} ${surface.blurb}`);
        console.log(`  ${''.padEnd(13)} e.g. ${surface.example}\n`);
      }
      answers.surface = (await rl.question('Primary surface [conversation]: ')).trim() || 'conversation';
      if (!SURFACES[answers.surface]) console.log(`  Not one of: ${Object.keys(SURFACES).join(', ')}`);
    }
  } finally {
    rl.close();
  }
  return answers;
}

/**
 * Expands the template placeholders.
 *
 * Deliberately a literal replace rather than a template engine: the generated
 * source is meant to be read and edited by whoever runs this, and a dependency
 * here would be a dependency in the thing that exists to keep dependencies
 * down.
 */
function render(source, context) {
  return source
    .replace(/__PLATFORM__/g, context.name)
    .replace(/__PLATFORM_TITLE__/g, context.title)
    .replace(/__SURFACE__/g, context.surface)
    .replace(/__PRIMARY_SURFACE__/g, context.primary)
    .replace(/__DUAL__/g, String(context.dual))
    .replace(/__KIT_VERSION__/g, context.kitVersion)
    .replace(/__PORT__/g, String(context.port));
}

/*
 * Blocks whose fences are stripped when the condition holds and whose body is
 * removed when it does not, so the generated source carries no dead branches
 * or commented-out alternatives for a surface the portal does not have.
 */
function applyConditionals(source, context) {
  return source.replace(
    /[ \t]*\/\*\s*IF:(\w+)\s*\*\/\n([\s\S]*?)[ \t]*\/\*\s*ENDIF:\1\s*\*\/\n/g,
    (_match, flag, body) => (context.flags[flag] ? body : ''),
  );
}

function copyTree(from, to, context) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const source = join(from, entry);
    const target = join(to, render(entry, context).replace(/\.template$/, ''));
    if (statSync(source).isDirectory()) {
      copyTree(source, target, context);
      continue;
    }
    const text = readFileSync(source, 'utf8');
    writeFileSync(target, applyConditionals(render(text, context), context));
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const { name, surface } = await prompt(args);
  const config = SURFACES[surface];

  const context = {
    name,
    title: name.replace(/(^|-)([a-z])/g, (_m, sep, ch) => (sep ? ' ' : '') + ch.toUpperCase()),
    surface,
    // Section 5a item 5: a dual-mode portal starts on workbench, matching
    // predictive. A single-surface portal's primary is its only surface.
    primary: config.dual ? 'workbench' : surface,
    dual: config.dual,
    kitVersion: KIT_VERSION,
    // Each existing portal already claims a port; 4181 is the next free one
    // after predictive's 4180.
    port: 4181,
    flags: {
      dual: config.dual,
      conversation: surface === 'conversation' || config.dual,
      workbench: surface === 'workbench' || config.dual,
    },
  };

  const target = args.out ? args.out : join(process.cwd(), `${name}-agent-platform-portal`);
  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(`\n${relative(process.cwd(), target) || target} exists and is not empty.`);
    process.exit(1);
  }

  copyTree(TEMPLATE, target, context);

  const where = relative(process.cwd(), target) || target;
  console.log(`\nCreated ${where}`);
  console.log(`  platform        ${name}`);
  console.log(`  primary surface ${context.primary}${config.dual ? ' (dual-mode: both surfaces, explicit toggle)' : ''}`);
  console.log(`  kit             @scurve/portal-kit#v${KIT_VERSION}`);
  console.log(`
It already conforms: src/ layout (section 3), kit API client (section 4),
kit tokens and primitives (sections 5 and 5a), TypeScript (section 6), Vite
with the standard dev/build/preview scripts.

  cd ${where}
  npm install
  npm run dev

With no platform running yet, point it at the kit's mock so there is
something to connect to:

  node node_modules/@scurve/portal-kit/scripts/mock-platform.mjs --platform causal --port 8099
  VITE_API_BASE=http://127.0.0.1:8099 npm run dev

Then replace src/${name}Service.ts with your platform's own endpoints. That
file is the only place a request shape should appear.`);
}

await main();
