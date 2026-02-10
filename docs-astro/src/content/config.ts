import { defineCollection, z } from 'astro:content';

// Define the schema for documentation content
const docsSchema = z.object({
  title: z.string(),
  description: z.string(),
  /**
   * Optional SEO slug override.
   *
   * Used by migration tooling to preserve legacy Docusaurus URLs even when
   * files are reorganized in the content tree.
   */
  slug: z.string().optional(),
  category: z.enum([
    'getting-started',
    'workflows',
    'cli-commands',
    'dashboard',
    'architecture',
    'api',
    'troubleshooting',
  ]),
  order: z.number().optional(),
  locale: z.enum(['en', 'zh']),
});

// Define content collections
const docs = defineCollection({
  type: 'content',
  schema: docsSchema,
});

const guides = defineCollection({
  type: 'content',
  schema: docsSchema,
});

const apiReference = defineCollection({
  type: 'content',
  schema: docsSchema,
});

// Export collections
export const collections = {
  docs,
  guides,
  'api-reference': apiReference,
};
