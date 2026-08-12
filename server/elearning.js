/**
 * The self-paced side: Odoo's eLearning (`slide.channel`), extended in-house by
 * `elearning_path`.
 *
 * Kept apart from `events.js` on purpose, because they are different things
 * wearing the same word. An `event.event` is training with a date, a room and a
 * register — somebody turns up at seven. A `slide.channel` is a bundle of
 * recorded content somebody works through whenever they like. Merging them into
 * one "courses" list would mean every column is meaningless for half the rows:
 * a video has no attendance, and a lecture has no completion percentage.
 *
 * **This reader is deliberately defensive, and that is not paranoia.** The Zoom
 * integration taught it: `is_zoom_meet` is in the customisation's source and is
 * not on the server, and asking Odoo for a field it does not have fails the
 * whole query rather than one column. So every field list here is intersected
 * with what the live database reports before anything is requested. The page
 * then works against a stock Odoo, against the customisation, and against
 * whatever the two become next year.
 */

import { OdooError, existingFields, odooConfigured, readGroup, searchRead } from './odoo.js';

import { makeCache } from './cache.js';
import { analyticsPeriod, publicPeriod } from './analyticsPeriod.js';
import { clearInsightsRevenueCache, recordedRevenueForPeriod } from './insightsRevenue.js';

const cache = makeCache(5 * 60_000);
const cached = (key, load) => cache.get(key, load);

const nameOf = (pair) => (Array.isArray(pair) ? pair[1] : null);
const idOf = (pair) => (Array.isArray(pair) ? pair[0] : null);
const text = (value) => (typeof value === 'string' && value ? value : null);

/**
 * Odoo does not expose a dependable "this course is free" flag in this
 * database. `list_price` is zero even on paid courses because the real price
 * comes from website pricelists and promotions, and The Freelance Masterclass
 * is still configured with `enroll=payment` although it is a free inclusion.
 *
 * Template ids are the stable join key used by package lines and sale lines.
 * The default records the known Engosoft free course; the environment variable
 * makes the business rule editable without a deploy when another free course
 * is introduced. Zero-value sale lines are excluded independently as a second
 * guard, so a free checkout can never become paid demand.
 */
function freeCourseTemplateIds() {
  return new Set(
    (process.env.ODOO_FREE_COURSE_TEMPLATE_IDS || '2056')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter(Number.isInteger)
  );
}

/**
 * Everything worth showing, and nothing that must be there.
 *
 * `name` is the only field assumed to exist — it is on every Odoo model. The
 * rest are asked for only if the server reports them, and the shaping below
 * treats each as optional.
 */
const CHANNEL_WISHLIST = [
  'name',
  'description_short',
  'channel_type',
  'total_slides',
  'total_time',
  'total_views',
  'members_count',
  // Odoo 17 names these `members_*`, not `completed_count`. Getting it wrong is
  // what the probe below is meant to catch — and it did, silently, by leaving
  // every completion at zero until somebody looked at the page and said so.
  'members_completed_count',
  'members_engaged_count',
  'active',
  'is_published',
  'user_id',
  'visibility',
  'enroll',
  'product_id',
  'path_channel_ids',
];

let channelFieldsCache = null;
async function channelFields() {
  if (!channelFieldsCache) channelFieldsCache = await existingFields('slide.channel', CHANNEL_WISHLIST);
  return channelFieldsCache;
}

function shapeChannel(row) {
  const members = row.members_count ?? 0;
  const completed = row.members_completed_count ?? 0;
  return {
    id: row.id,
    name: text(row.name) ?? 'بدون اسم',
    summary: text(row.description_short),
    // `documentation` is a reference library, `training` is a course with a
    // path through it — different enough to be worth saying.
    kind: text(row.channel_type),
    lessons: row.total_slides ?? 0,
    // Odoo keeps this in hours as a float.
    hours: Number(row.total_time ?? 0),
    views: row.total_views ?? 0,
    // Enrolled and actually doing something, which on this data is most of them
    // — the gap that matters here is engaged→completed, not enrolled→engaged.
    engaged: row.members_engaged_count ?? 0,
    members,
    completed,
    completionRate: members > 0 ? Math.round((completed / members) * 100) : null,
    published: row.is_published !== false,
    active: row.active !== false,
    owner: nameOf(row.user_id),
    access: text(row.enroll),
    productId: idOf(row.product_id),
    productName: nameOf(row.product_id),
  };
}

/** The list the page opens on: every course, busiest first. */
export async function elearningOverview() {
  if (!odooConfigured()) throw new OdooError('odoo_not_configured', 503);

  return cached('overview', async () => {
    const fields = await channelFields();
    const currentDomain = [];
    if (fields.includes('active')) currentDomain.push(['active', '=', true]);
    if (fields.includes('is_published')) currentDomain.push(['is_published', '=', true]);
    if (fields.includes('channel_type')) currentDomain.push(['channel_type', '=', 'training']);
    const rows = await searchRead('slide.channel', currentDomain, fields, { limit: 500 });
    const productIds = [...new Set(rows.map((row) => idOf(row.product_id)).filter(Boolean))];
    const productFields = productIds.length
      ? await existingFields('product.product', [
          'name',
          'active',
          'product_tmpl_id',
          'currency_id',
        ])
      : [];
    const products = productIds.length
      ? await searchRead('product.product', [['id', 'in', productIds]], productFields, {
          limit: productIds.length,
        })
      : [];
    const productsById = new Map(products.map((product) => [product.id, product]));
    const templateIds = [...new Set(products.map((product) => idOf(product.product_tmpl_id)).filter(Boolean))];
    const templateFields = templateIds.length
      ? await existingFields('product.template', [
          'name',
          'active',
          'sale_ok',
          'is_published',
          'detailed_type',
        ])
      : [];
    const templates = templateIds.length
      ? await searchRead('product.template', [['id', 'in', templateIds]], templateFields, {
          limit: templateIds.length,
          context: { active_test: false },
        })
      : [];
    const templatesById = new Map(templates.map((template) => [template.id, template]));
    const knownFree = freeCourseTemplateIds();
    const courses = rows
      .map((row) => {
        const course = shapeChannel(row);
        const product = productsById.get(course.productId);
        const productTemplateId = idOf(product?.product_tmpl_id);
        const template = templatesById.get(productTemplateId);
        const free = row.enroll === 'public' || knownFree.has(productTemplateId);
        const sellable = Boolean(
          course.productId &&
            productTemplateId &&
            product?.active !== false &&
            template &&
            template.active !== false &&
            template.sale_ok !== false &&
            template.is_published !== false &&
            (!templateFields.includes('detailed_type') || template.detailed_type === 'course')
        );
        return {
          ...course,
          productTemplateId,
          currency: nameOf(product?.currency_id),
          free,
          sellable,
          // A product is the only reliable bridge to a confirmed paid order.
          // Invite-only internal channels without one remain learning activity,
          // but are not presented as a product that failed to sell.
          commercial: Boolean(sellable && !free),
        };
      })
      .sort((a, b) => b.members - a.members);

    return {
      courses,
      // Reported so the page can say "this Odoo does not expose completion"
      // rather than silently drawing a chart of zeroes.
      available: fields,
      fetchedAt: new Date().toISOString(),
    };
  });
}

const ENROLLED_STATUSES = new Set(['joined', 'ongoing', 'completed']);
const STARTED_STATUSES = new Set(['ongoing', 'completed']);

function channelId(pair) {
  return Array.isArray(pair) ? pair[0] : null;
}

function membershipCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    const id = channelId(row.channel_id);
    if (!id) continue;
    const count = row.__count ?? 0;
    const current = counts.get(id) ?? {
      invited: 0,
      enrollments: 0,
      started: 0,
      completed: 0,
    };
    if (row.member_status === 'invited') current.invited += count;
    if (ENROLLED_STATUSES.has(row.member_status)) current.enrollments += count;
    if (STARTED_STATUSES.has(row.member_status)) current.started += count;
    if (row.member_status === 'completed') current.completed += count;
    counts.set(id, current);
  }
  return counts;
}

/** Pure shaping for the selected-period membership funnel and demand ranking. */
export function buildElearningPeriodSnapshot(courses, membershipRows) {
  const counts = membershipCounts(membershipRows);
  const ranked = courses.map((course) => {
    const period = counts.get(course.id) ?? {
      invited: 0,
      enrollments: 0,
      started: 0,
      completed: 0,
    };
    return {
      id: course.id,
      name: course.name,
      published: course.published,
      members: course.members,
      completionRate: course.completionRate,
      ...period,
      demand: period.invited + period.enrollments,
    };
  });

  const totals = ranked.reduce(
    (sum, course) => ({
      invited: sum.invited + course.invited,
      enrollments: sum.enrollments + course.enrollments,
      started: sum.started + course.started,
      completed: sum.completed + course.completed,
      activeCourses: sum.activeCourses + (course.demand > 0 ? 1 : 0),
      noEnrollment: sum.noEnrollment + (course.enrollments === 0 ? 1 : 0),
      noDemand: sum.noDemand + (course.demand === 0 ? 1 : 0),
    }),
    {
      invited: 0,
      enrollments: 0,
      started: 0,
      completed: 0,
      activeCourses: 0,
      noEnrollment: 0,
      noDemand: 0,
    }
  );

  const denominator = totals.invited + totals.enrollments;
  const demandOrder = (a, b) =>
    b.enrollments - a.enrollments || b.invited - a.invited || a.name.localeCompare(b.name, 'ar');
  const lowOrder = (a, b) =>
    a.enrollments - b.enrollments || a.invited - b.invited || a.name.localeCompare(b.name, 'ar');

  return {
    totals: {
      ...totals,
      courses: courses.length,
      published: courses.filter((course) => course.published).length,
      conversionRate: denominator > 0 ? Math.round((totals.enrollments / denominator) * 100) : null,
      startRate:
        totals.enrollments > 0 ? Math.round((totals.started / totals.enrollments) * 100) : null,
      completionRate:
        totals.enrollments > 0 ? Math.round((totals.completed / totals.enrollments) * 100) : null,
    },
    topDemand: [...ranked].filter((course) => course.demand > 0).sort(demandOrder).slice(0, 10),
    lowDemand: [...ranked].sort(lowOrder).slice(0, 10),
  };
}

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function earlierThanOrEqual(left, right) {
  return !left || !right || String(left) <= String(right);
}

function canonicalCourseByTemplate(courses) {
  const result = new Map();
  for (const course of courses) {
    if (!course.productTemplateId) continue;
    const current = result.get(course.productTemplateId);
    if (
      !current ||
      (course.published && !current.published) ||
      (course.published === current.published && course.members > current.members)
    ) {
      result.set(course.productTemplateId, course);
    }
  }
  return result;
}

/**
 * Turn confirmed sale lines into one non-duplicated commercial picture.
 *
 * A package is not a product in this Odoo. Checkout adds each mapped course as
 * a sale line, so blindly grouping by product counts one package six times.
 * We recognise the mapped set inside an order, assign the order to the largest
 * matching package, and remove those lines from direct-course sales. Components
 * still receive `packageSales` so the manager can see how often a course moved
 * inside packages. Money deliberately does not leave this reducer: accounting
 * revenue comes from Insights Hub's paid invoices, not mixed-currency Odoo sale
 * line subtotals.
 */
export function buildElearningSalesSnapshot(courses, products, packages, saleLines) {
  const freeTemplates = freeCourseTemplateIds();
  for (const course of courses) {
    if (course.free && course.productTemplateId) freeTemplates.add(course.productTemplateId);
  }
  const productsById = new Map(products.map((product) => [product.id, product]));
  const canonicalCourses = canonicalCourseByTemplate(courses);
  const catalogByTemplate = new Map();

  for (const product of products) {
    if (!product.templateId || freeTemplates.has(product.templateId)) continue;
    const course = canonicalCourses.get(product.templateId);
    const current = catalogByTemplate.get(product.templateId);
    if (!current || course) {
      catalogByTemplate.set(product.templateId, {
        id: course?.id ?? -product.templateId,
        templateId: product.templateId,
        name: course?.name ?? product.name ?? 'بدون اسم',
        published: course?.published ?? true,
        directSales: 0,
        packageSales: 0,
        directOrders: new Set(),
        packageOrders: new Set(),
        packageNames: new Set(),
      });
    }
  }

  const packageStates = new Map(
    packages.map((item) => [
      item.id,
      {
        id: item.id,
        name: item.name,
        componentCount: item.components.filter((component) => !freeTemplates.has(component.templateId))
          .length,
        components: item.components.map((component) => component.name),
        sales: 0,
        orders: new Set(),
      },
    ])
  );

  const orders = new Map();
  for (const row of saleLines) {
    const orderId = idOf(row.order_id);
    const productId = idOf(row.product_id);
    const product = productsById.get(productId);
    const quantity = number(row.product_uom_qty);
    if (!orderId || !product?.templateId || quantity <= 0) continue;
    const order = orders.get(orderId) ?? { at: row.create_date ?? null, lines: [] };
    if (row.create_date && (!order.at || row.create_date < order.at)) order.at = row.create_date;
    order.lines.push({
      productId,
      templateId: product.templateId,
      quantity,
      subtotal: number(row.price_subtotal),
    });
    orders.set(orderId, order);
  }

  const paidOrders = new Set();
  let directSales = 0;
  for (const [orderId, order] of orders) {
    const quantities = new Map();
    for (const line of order.lines) {
      quantities.set(line.templateId, (quantities.get(line.templateId) ?? 0) + line.quantity);
    }

    const candidates = packages
      .filter((item) => earlierThanOrEqual(item.createdAt, order.at))
      .map((item) => {
        const activeComponents = item.components.filter((component) =>
          earlierThanOrEqual(component.createdAt, order.at)
        );
        const required = [
          ...new Set(
            activeComponents
              .map((component) => component.templateId)
              .filter((templateId) => templateId && !freeTemplates.has(templateId))
          ),
        ];
        return { item, activeComponents, required };
      })
      .filter(
        ({ required }) =>
          required.length >= 2 && required.every((templateId) => number(quantities.get(templateId)) > 0)
      )
      .sort(
        (a, b) =>
          b.required.length - a.required.length ||
          b.activeComponents.length - a.activeComponents.length ||
          a.item.id - b.item.id
      );

    const matched = candidates[0] ?? null;
    const packageTemplates = new Set(
      matched?.activeComponents.map((component) => component.templateId).filter(Boolean) ?? []
    );

    if (matched) {
      const units = Math.min(...matched.required.map((templateId) => quantities.get(templateId) ?? 0));
      const revenue = order.lines
        .filter(
          (line) => packageTemplates.has(line.templateId) && !freeTemplates.has(line.templateId) && line.subtotal > 0
        )
        .reduce((sum, line) => sum + line.subtotal, 0);
      const state = packageStates.get(matched.item.id);
      // A package whose component lines are all zero is a free inclusion, not
      // paid demand. One positive component is enough because Odoo distributes
      // a package price over its component lines instead of selling one SKU.
      if (revenue > 0 && units > 0) {
        state.sales += units;
        state.orders.add(orderId);
        paidOrders.add(orderId);

        for (const templateId of matched.required) {
          const course = catalogByTemplate.get(templateId);
          if (!course) continue;
          course.packageSales += units;
          course.packageOrders.add(orderId);
          course.packageNames.add(matched.item.name);
        }
      }
    }

    for (const line of order.lines) {
      if (packageTemplates.has(line.templateId) || freeTemplates.has(line.templateId) || line.subtotal <= 0) {
        continue;
      }
      const course = catalogByTemplate.get(line.templateId);
      if (!course) continue;
      course.directSales += line.quantity;
      course.directOrders.add(orderId);
      directSales += line.quantity;
      paidOrders.add(orderId);
    }
  }

  const courseRows = [...catalogByTemplate.values()].map((course) => ({
    id: course.id,
    templateId: course.templateId,
    name: course.name,
    published: course.published,
    directSales: course.directSales,
    packageSales: course.packageSales,
    totalSales: course.directSales + course.packageSales,
    directOrders: course.directOrders.size,
    packageOrders: course.packageOrders.size,
    packages: [...course.packageNames].sort((a, b) => a.localeCompare(b, 'ar')),
  }));
  const packageRows = [...packageStates.values()]
    .map((item) => ({
      id: item.id,
      name: item.name,
      componentCount: item.componentCount,
      components: item.components,
      sales: item.sales,
      orders: item.orders.size,
    }))
    .sort((a, b) => b.sales - a.sales || b.orders - a.orders || a.name.localeCompare(b.name, 'ar'));

  const packagesSold = packageRows.reduce((sum, item) => sum + item.sales, 0);
  const withSales = courseRows.filter((course) => course.totalSales > 0);

  return {
    totals: {
      paidOrders: paidOrders.size,
      purchases: directSales + packagesSold,
      directSales,
      packagesSold,
      paidCourses: courseRows.length,
      coursesWithSales: withSales.length,
      noSales: courseRows.length - withSales.length,
      freeExcluded: courses.filter((course) => course.free).length,
    },
    topCourses: withSales
      .sort(
        (a, b) =>
          b.totalSales - a.totalSales ||
          b.directOrders - a.directOrders ||
          a.name.localeCompare(b.name, 'ar')
      )
      .slice(0, 12),
    noSales: courseRows
      .filter((course) => course.totalSales === 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
      .slice(0, 12),
    packages: packageRows,
  };
}

async function salesCatalog(courses) {
  const products = courses
    .filter((course) => course.commercial && course.productId && course.productTemplateId)
    .map((course) => ({
      id: course.productId,
      templateId: course.productTemplateId,
      name: course.productName ?? course.name,
    }));
  const allowedTemplates = new Set(
    courses.filter((course) => course.commercial).map((course) => course.productTemplateId)
  );
  const freeTemplates = freeCourseTemplateIds();
  for (const course of courses) {
    if (course.free && course.productTemplateId) freeTemplates.add(course.productTemplateId);
  }

  let packages = [];
  try {
    const [packageFields, lineFields] = await Promise.all([
      existingFields('training.package', [
        'name',
        'active',
        'currency_id',
        'create_date',
        'final_price',
        'total_price',
      ]),
      existingFields('training.package.product.line', [
        'package_id',
        'product_id',
        'level_id',
        'create_date',
      ]),
    ]);
    const packageDomain = packageFields.includes('active') ? [['active', '=', true]] : [];
    const packageRows = await searchRead('training.package', packageDomain, packageFields, { limit: 500 });
    const packageIds = packageRows.map((item) => item.id);
    const lines = packageIds.length
      ? await searchRead(
          'training.package.product.line',
          [['package_id', 'in', packageIds]],
          lineFields,
          { limit: 5000 }
        )
      : [];
    const templateIds = [...new Set(lines.map((line) => idOf(line.product_id)).filter(Boolean))];
    const variantFields = templateIds.length
      ? await existingFields('product.product', ['name', 'product_tmpl_id'])
      : [];
    const variants = templateIds.length
      ? await searchRead('product.product', [['product_tmpl_id', 'in', templateIds]], variantFields, {
          limit: 5000,
        })
      : [];
    for (const variant of variants) {
      const templateId = idOf(variant.product_tmpl_id);
      if (
        !templateId ||
        (!allowedTemplates.has(templateId) && !freeTemplates.has(templateId)) ||
        products.some((product) => product.id === variant.id)
      ) {
        continue;
      }
      products.push({ id: variant.id, templateId, name: text(variant.name) ?? nameOf(variant.product_tmpl_id) });
    }

    const linesByPackage = new Map();
    for (const line of lines) {
      const packageId = idOf(line.package_id);
      const templateId = idOf(line.product_id);
      if (
        !packageId ||
        !templateId ||
        (!allowedTemplates.has(templateId) && !freeTemplates.has(templateId))
      ) {
        continue;
      }
      const current = linesByPackage.get(packageId) ?? [];
      current.push({
        templateId,
        name: nameOf(line.product_id) ?? 'بدون اسم',
        level: nameOf(line.level_id),
        createdAt: line.create_date ?? null,
      });
      linesByPackage.set(packageId, current);
    }
    packages = packageRows
      .map((item) => ({
        id: item.id,
        name: text(item.name) ?? 'باقة بدون اسم',
        createdAt: item.create_date ?? null,
        currency: nameOf(item.currency_id),
        listPrice: number(item.total_price),
        finalPrice: number(item.final_price),
        components: linesByPackage.get(item.id) ?? [],
      }))
      .filter((item) => item.components.length >= 2);
  } catch {
    // Stock Odoo has no `training.package`. Direct course sales remain exact;
    // package analytics simply returns an empty list on those installations.
    packages = [];
  }

  return { products, packages };
}

async function commercialSales(courses, period) {
  const { products, packages } = await salesCatalog(courses);
  const productIds = [...new Set(products.map((product) => product.id).filter(Boolean))];
  if (!productIds.length) {
    const empty = buildElearningSalesSnapshot(courses, products, packages, []);
    return { current: empty, previous: empty };
  }
  const saleFields = await existingFields('sale.order.line', [
    'order_id',
    'product_id',
    'product_uom_qty',
    'price_subtotal',
    'create_date',
    'state',
  ]);
  const required = ['order_id', 'product_id', 'product_uom_qty', 'price_subtotal', 'create_date'];
  if (required.some((field) => !saleFields.includes(field))) throw new Error('sales_fields_unavailable');
  const domainFor = (fromOdoo, toOdoo) => [
    ['product_id', 'in', productIds],
    ['state', 'in', ['sale', 'done']],
    ['product_uom_qty', '>', 0],
    ['order_id.date_order', '>=', fromOdoo],
    ['order_id.date_order', '<', toOdoo],
  ];
  const [currentRows, previousRows] = await Promise.all([
    searchRead(
      'sale.order.line',
      domainFor(period.fromOdoo, period.toOdooExclusive),
      saleFields,
      { limit: 20_000 }
    ),
    searchRead(
      'sale.order.line',
      domainFor(period.previousFromOdoo, period.previousToOdooExclusive),
      saleFields,
      { limit: 20_000 }
    ),
  ]);
  return {
    current: buildElearningSalesSnapshot(courses, products, packages, currentRows),
    previous: buildElearningSalesSnapshot(courses, products, packages, previousRows),
  };
}

function membershipTrend(rows) {
  const points = new Map();
  for (const row of rows) {
    const raw = String(row['create_date:month'] ?? '');
    const [month, year] = raw.split(' ');
    const key = `${year ?? ''}-${String(Object.keys(MONTHS_AR).indexOf(month?.toLowerCase()) + 1).padStart(2, '0')}`;
    const point = points.get(raw) ?? {
      key,
      label: `${MONTHS_AR[month?.toLowerCase()] ?? month ?? '—'}${year ? ` ${Number(year).toLocaleString('ar-EG', { useGrouping: false })}` : ''}`,
      enrollments: 0,
      invited: 0,
      completed: 0,
    };
    const count = row.__count ?? 0;
    if (row.member_status === 'invited') point.invited += count;
    if (ENROLLED_STATUSES.has(row.member_status)) point.enrollments += count;
    if (row.member_status === 'completed') point.completed += count;
    points.set(raw, point);
  }
  return [...points.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const MONTHS_AR = {
  january: 'يناير',
  february: 'فبراير',
  march: 'مارس',
  april: 'أبريل',
  may: 'مايو',
  june: 'يونيو',
  july: 'يوليو',
  august: 'أغسطس',
  september: 'سبتمبر',
  october: 'أكتوبر',
  november: 'نوفمبر',
  december: 'ديسمبر',
};

export async function elearningAnalytics({ from, to } = {}) {
  if (!odooConfigured()) throw new OdooError('odoo_not_configured', 503);
  const period = analyticsPeriod({ from, to });

  return cached(`analytics:${period.from}:${period.to}`, async () => {
    // Start the external accounting read while Odoo is doing its own catalogue
    // and membership work. They are independent authorities and often have very
    // different response times.
    const revenuePromise = recordedRevenueForPeriod(period).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error })
    );
    const { courses, available } = await elearningOverview();
    const has = (field) => available.includes(field);

    const published = courses.filter((course) => course.published);
    const commercialCourses = courses.filter((course) => course.commercial);
    const freeCourses = courses.filter((course) => course.free);
    const members = courses.reduce((sum, course) => sum + course.members, 0);
    const completed = courses.reduce((sum, course) => sum + course.completed, 0);
    const lessons = courses.reduce((sum, course) => sum + course.lessons, 0);
    const hours = courses.reduce((sum, course) => sum + course.hours, 0);

    let byKind = [];
    if (has('channel_type')) {
      const groups = await readGroup('slide.channel', [], ['channel_type']);
      byKind = groups.map((row) => ({
        label:
          row.channel_type === 'training'
            ? 'مسار تدريبي'
            : row.channel_type === 'documentation'
              ? 'مكتبة محتوى'
              : row.channel_type === 'path'
                ? 'مسار كورسات'
              : 'مش محدد',
        value: row.__count ?? 0,
      }));
    }

    let salesAvailable = true;
    let salesError = null;
    let sales = null;
    try {
      sales = await commercialSales(courses, period);
    } catch (error) {
      salesAvailable = false;
      salesError = error?.message || 'sales_analytics_unavailable';
    }

    const revenueResult = await revenuePromise;
    const collected = revenueResult.value;
    const revenueAvailable = Boolean(collected);
    const revenueError = revenueResult.error
      ? revenueResult.error?.name === 'AbortError'
        ? 'insights_timeout'
        : revenueResult.error?.message || 'insights_unavailable'
      : null;

    const base = {
      period: publicPeriod(period),
      totals: {
        courses: courses.length,
        published: published.length,
        draft: courses.length - published.length,
        members,
        completed,
        lessons,
        hours: Math.round(hours),
        engaged: courses.reduce((sum, course) => sum + course.engaged, 0),
        completionRate:
          has('members_completed_count') && members > 0
            ? Math.round((completed / members) * 100)
            : null,
      },
      byKind,
      topByMembers: commercialCourses
        .filter((course) => course.members > 0)
        .sort((a, b) => b.members - a.members)
        .slice(0, 8)
        .map((course) => ({ label: course.name, value: course.members })),
      topByCompletion: commercialCourses
        .filter((course) => course.members >= 5 && course.completionRate !== null)
        .sort((a, b) => (b.completionRate ?? 0) - (a.completionRate ?? 0))
        .slice(0, 8)
        .map((course) => ({
          label: course.name,
          value: course.completionRate ?? 0,
          display: `${course.completionRate}٪`,
        })),
      biggest: courses
        .filter((course) => course.lessons > 0)
        .sort((a, b) => b.lessons - a.lessons)
        .slice(0, 8)
        .map((course) => ({ label: course.name, value: course.lessons })),
      available,
      salesAvailable,
      salesError,
      revenueAvailable,
      revenueError,
      currency: collected?.currency ?? null,
      collectedCurrent: collected?.current ?? null,
      collectedPrevious: collected?.previous ?? null,
      revenueSource: collected?.source ?? null,
      revenueStale: collected?.stale ?? false,
      commercialCurrent: sales?.current?.totals ?? null,
      commercialPrevious: sales?.previous?.totals ?? null,
      topPaidCourses: sales?.current?.topCourses ?? [],
      noPaidSales: sales?.current?.noSales ?? [],
      packageSales: (sales?.current?.packages ?? []).map((item) => ({
        ...item,
        previousSales:
          sales?.previous?.packages.find((previous) => previous.id === item.id)?.sales ?? 0,
      })),
      fetchedAt: new Date().toISOString(),
    };

    try {
      const currentDomain = [
        ['active', '=', true],
        ['create_date', '>=', period.fromOdoo],
        ['create_date', '<', period.toOdooExclusive],
      ];
      const previousDomain = [
        ['active', '=', true],
        ['create_date', '>=', period.previousFromOdoo],
        ['create_date', '<', period.previousToOdooExclusive],
      ];
      const commercialIds = commercialCourses.map((course) => course.id);
      const trendDomain = commercialIds.length
        ? [...currentDomain, ['channel_id', 'in', commercialIds]]
        : [...currentDomain, ['id', '=', 0]];
      const [currentRows, previousRows, trendRows] = await Promise.all([
        readGroup('slide.channel.partner', currentDomain, ['channel_id', 'member_status']),
        readGroup('slide.channel.partner', previousDomain, ['channel_id', 'member_status']),
        readGroup('slide.channel.partner', trendDomain, ['create_date:month', 'member_status']),
      ]);
      const current = buildElearningPeriodSnapshot(commercialCourses, currentRows);
      const previous = buildElearningPeriodSnapshot(commercialCourses, previousRows);
      const freeActivity = buildElearningPeriodSnapshot(freeCourses, currentRows);
      return {
        ...base,
        periodAvailable: true,
        current: current.totals,
        previous: previous.totals,
        topDemand: current.topDemand,
        lowDemand: current.lowDemand,
        trend: membershipTrend(trendRows),
        freeActivity: freeActivity.totals,
      };
    } catch (error) {
      // `slide.channel` can be readable while the member relation is restricted
      // to eLearning officers. The all-time catalogue remains useful; the page
      // says why the period funnel is unavailable instead of presenting zeroes.
      return {
        ...base,
        periodAvailable: false,
        periodError: error?.message || 'membership_analytics_unavailable',
        current: null,
        previous: null,
        topDemand: [],
        lowDemand: [],
        trend: [],
        freeActivity: null,
      };
    }
  });
}

export function clearElearningCache() {
  cache.clear();
  clearInsightsRevenueCache();
  channelFieldsCache = null;
}
