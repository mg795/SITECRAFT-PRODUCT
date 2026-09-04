'use strict';
/*
 * The SiteCraft component library, and what a client may change inside one.
 *
 * The permission model is a whitelist and nothing else: a client can change a
 * field only because this file says the field exists and is editable. There is no
 * "everything except" list anywhere in SiteCraft, and there is deliberately no
 * field for a font, a width, a colour, a breakpoint or a stylesheet — those are
 * not restricted, they simply are not part of a component. A component that grows
 * a new editable field grows it here, once, for every site at the same time.
 *
 * Phase 1 keeps this library small on purpose. A type earns its place when a real
 * client needs it, not because a source site happened to be built that way.
 */

/* What a field is, and therefore what the editor puts in front of a client. */
const KINDS = {
  text:     'A single line of words',
  richtext: 'A paragraph or two',
  image:    'A picture, with its description',
  link:     'Where something goes when it is clicked',
  list:     'A short list of lines',
  items:    'The repeated entries inside the component',
  embed:    'An approved third-party embed, shown but not editable',
};

/* Every component in Phase 1. `fields` is the whole of what can ever be edited. */
const LIBRARY = {
  hero: {
    label: 'Hero',
    hint: 'The band at the top of a page: a headline, some words and usually a picture.',
    duplicatable: false,
    fields: {
      eyebrow:  { kind:'text',     label:'Eyebrow',      editable:true, optional:true, max:60 },
      headline: { kind:'text',     label:'Headline',     editable:true, max:120 },
      body:     { kind:'richtext', label:'Body Copy',    editable:true, optional:true, max:400 },
      image:    { kind:'image',    label:'Image',        editable:true, optional:true },
      ctaLabel: { kind:'text',     label:'Button Label', editable:true, optional:true, max:40 },
      ctaHref:  { kind:'link',     label:'Button Link',  editable:true, optional:true },
    },
  },
  text: {
    label: 'Text',
    hint: 'A headline and body copy, with no picture.',
    duplicatable: true,
    /* a heading over a list is a real block on a real site, so either satisfies it */
    requires: [['body','list']],
    fields: {
      headline: { kind:'text',     label:'Headline',  editable:true, optional:true, max:120 },
      body:     { kind:'richtext', label:'Body Copy', editable:true, optional:true, max:2000 },
      list:     { kind:'list',     label:'List',      editable:true, optional:true },
    },
  },
  image: {
    label: 'Image',
    hint: 'A picture on its own.',
    duplicatable: true,
    fields: {
      image:   { kind:'image', label:'Image',   editable:true },
      caption: { kind:'text',  label:'Caption', editable:true, optional:true, max:160 },
    },
  },
  image_text: {
    label: 'Image and Text',
    hint: 'A picture beside a headline and some words.',
    duplicatable: true,
    requires: [['body','list']],
    fields: {
      headline: { kind:'text',     label:'Headline',     editable:true, optional:true, max:120 },
      body:     { kind:'richtext', label:'Body Copy',    editable:true, optional:true, max:1200 },
      image:    { kind:'image',    label:'Image',        editable:true },
      list:     { kind:'list',     label:'List',         editable:true, optional:true },
      ctaLabel: { kind:'text',     label:'Button Label', editable:true, optional:true, max:40 },
      ctaHref:  { kind:'link',     label:'Button Link',  editable:true, optional:true },
    },
  },
  cta: {
    label: 'Call to Action',
    hint: 'A short line and a button.',
    duplicatable: true,
    fields: {
      headline: { kind:'text',     label:'Headline',     editable:true, max:120 },
      body:     { kind:'richtext', label:'Body Copy',    editable:true, optional:true, max:400 },
      ctaLabel: { kind:'text',     label:'Button Label', editable:true, max:40 },
      ctaHref:  { kind:'link',     label:'Button Link',  editable:true },
    },
  },
  featured_item: {
    label: 'Featured Items',
    hint: 'A repeating row of the same thing: a property, a service, a person, a project.',
    duplicatable: true,
    /* the whole point of this component is that a client adds one more of them */
    itemsEditable: true,
    fields: {
      headline: { kind:'text',  label:'Headline', editable:true, optional:true, max:120 },
      items:    { kind:'items', label:'Items',    editable:true,
                  item: {
                    title: { kind:'text',     label:'Title',       editable:true, max:120 },
                    body:  { kind:'richtext', label:'Description', editable:true, optional:true, max:400 },
                    image: { kind:'image',    label:'Picture',     editable:true, optional:true },
                    href:  { kind:'link',     label:'Link',        editable:true, optional:true },
                    meta:  { kind:'text',     label:'Detail',      editable:true, optional:true, max:60 },
                  } },
    },
  },
  blog_listing: {
    label: 'Blog Listing',
    hint: 'Shows the posts by itself. Nothing here is typed in by hand.',
    duplicatable: false,
    /* the entries come from the posts, so there is nothing in them to edit */
    fields: {
      headline: { kind:'text',     label:'Headline',  editable:true, optional:true, max:120 },
      body:     { kind:'richtext', label:'Body Copy', editable:true, optional:true, max:600 },
      source:   { kind:'text',     label:'Shows Posts From', editable:false },
    },
  },
  blog_post: {
    label: 'Blog Post',
    hint: 'One article, on the site’s own article template.',
    duplicatable: false,
    fields: {
      title:    { kind:'text',     label:'Title',          editable:true, max:160 },
      image:    { kind:'image',    label:'Featured Image', editable:true, optional:true },
      body:     { kind:'richtext', label:'Article',        editable:true },
      author:   { kind:'text',     label:'Author',         editable:true, optional:true, max:80 },
      date:     { kind:'text',     label:'Publish Date',   editable:true, optional:true },
    },
  },
  embed: {
    label: 'Third-Party Feature',
    hint: 'Something the client’s site does through another company: a booking tool, a map, a listings feed.',
    duplicatable: false,
    /* it is shown, never rebuilt, and never editable by a client */
    /* it is shown, never rebuilt, and nothing about it is a client's to change */
    fields: {
      headline: { kind:'text',     label:'Heading',   editable:true, optional:true, max:120 },
      body:     { kind:'richtext', label:'Body Copy', editable:true, optional:true, max:600 },
      vendor:   { kind:'text',     label:'Provider',  editable:false },
      feature:  { kind:'text',  label:'Feature',  editable:false },
      src:      { kind:'embed', label:'Embed',    editable:false },
    },
  },
};

/* The fields a client may change, given the library and whatever an administrator
   has since switched off on this one component. */
function editableFields(type, perms){
  const def = LIBRARY[type];
  if (!def) return [];
  return Object.keys(def.fields).filter(k =>
    def.fields[k].editable && (!perms || perms[k] !== false));
}

/* An administrator can only ever narrow what the library allows, never widen it:
   a permission for a field that does not exist, or for one the library locks, is
   dropped rather than honoured. */
function normalisePerms(type, perms){
  const def = LIBRARY[type];
  if (!def || !perms) return null;
  const out = {};
  for (const k of Object.keys(perms)){
    const f = def.fields[k];
    if (f && f.editable && perms[k] === false) out[k] = false;
  }
  return Object.keys(out).length ? out : null;
}

const isDuplicatable = (type, flag) =>
  !!(LIBRARY[type] && LIBRARY[type].duplicatable && flag !== false);

module.exports = { LIBRARY, KINDS, editableFields, normalisePerms, isDuplicatable };
