const { Client } = require('@elastic/elasticsearch');

const indexName = process.env.ELASTICSEARCH_EYEWEAR_INDEX || 'eyewear_products';
const elasticNode = process.env.ELASTICSEARCH_URL || process.env.ELASTICSEARCH_NODE || '';

const isEnabled = Boolean(elasticNode);
const client = isEnabled ? new Client({ node: elasticNode }) : null;
let indexEnsured = false;

function normalizeProduct(row) {
  return {
    id: Number(row.id),
    name: row.name,
    brand: row.brand || 'Khác',
    frame_type: row.frame_type || 'Khác',
    price: Number(row.price || 0),
    description: row.description || '',
    image_url: row.image_url,
    quantity: Number(row.quantity || 0),
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function ensureIndex() {
  if (!client || indexEnsured) {
    return;
  }

  const exists = await client.indices.exists({ index: indexName });
  if (!exists) {
    await client.indices.create({
      index: indexName,
      mappings: {
        properties: {
          id: { type: 'integer' },
          name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          brand: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          frame_type: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          description: { type: 'text' },
          image_url: { type: 'keyword' },
          quantity: { type: 'integer' },
          price: { type: 'float' },
          is_active: { type: 'boolean' },
          sort_order: { type: 'integer' },
          created_at: { type: 'date' },
          updated_at: { type: 'date' },
        },
      },
    });
  }

  indexEnsured = true;
}

async function indexProduct(row) {
  if (!client) {
    return;
  }

  await ensureIndex();
  const product = normalizeProduct(row);
  await client.index({
    index: indexName,
    id: String(product.id),
    document: product,
    refresh: 'wait_for',
  });
}

async function removeProduct(productId) {
  if (!client) {
    return;
  }

  await ensureIndex();
  try {
    await client.delete({
      index: indexName,
      id: String(productId),
      refresh: 'wait_for',
    });
  } catch (error) {
    if (error?.meta?.statusCode !== 404) {
      throw error;
    }
  }
}

async function bulkReindex(rows) {
  if (!client) {
    return;
  }

  await ensureIndex();
  if (!rows.length) {
    return;
  }

  const operations = [];
  for (const row of rows) {
    const product = normalizeProduct(row);
    operations.push({ index: { _index: indexName, _id: String(product.id) } });
    operations.push(product);
  }

  await client.bulk({
    refresh: true,
    operations,
  });
}

async function searchProducts(params) {
  if (!client) {
    throw new Error('Elasticsearch chưa được cấu hình.');
  }

  await ensureIndex();

  const {
    q = '',
    brand = '',
    frameType = '',
    minPrice = null,
    maxPrice = null,
    page = 1,
    size = 12,
  } = params;

  const must = [];
  const filter = [{ term: { is_active: true } }];

  if (q) {
    must.push({
      multi_match: {
        query: q,
        fields: ['name^4', 'brand^2', 'frame_type^2', 'description'],
        fuzziness: 'AUTO',
      },
    });
  }

  if (brand) {
    filter.push({ term: { 'brand.keyword': brand } });
  }

  if (frameType) {
    filter.push({ term: { 'frame_type.keyword': frameType } });
  }

  if (minPrice != null || maxPrice != null) {
    const range = {};
    if (minPrice != null) {
      range.gte = minPrice;
    }
    if (maxPrice != null) {
      range.lte = maxPrice;
    }
    filter.push({ range: { price: range } });
  }

  const query = {
    bool: {
      must: must.length ? must : [{ match_all: {} }],
      filter,
    },
  };

  const from = (page - 1) * size;
  const response = await client.search({
    index: indexName,
    from,
    size,
    query,
    sort: q ? [{ _score: 'desc' }, { sort_order: 'asc' }, { updated_at: 'desc' }] : [{ sort_order: 'asc' }, { updated_at: 'desc' }],
    aggs: {
      brands: { terms: { field: 'brand.keyword', size: 100 } },
      frame_types: { terms: { field: 'frame_type.keyword', size: 100 } },
      price_stats: { stats: { field: 'price' } },
    },
  });

  const hits = response.hits?.hits || [];
  const total = Number(response.hits?.total?.value || 0);
  const brands = (response.aggregations?.brands?.buckets || []).map((item) => item.key);
  const frameTypes = (response.aggregations?.frame_types?.buckets || []).map((item) => item.key);
  const priceStats = response.aggregations?.price_stats || {};

  return {
    items: hits.map((hit) => normalizeProduct(hit._source || {})),
    pagination: {
      page,
      size,
      total,
      total_pages: Math.max(1, Math.ceil(total / size)),
    },
    facets: {
      brands,
      frame_types: frameTypes,
      price: {
        min: Number(priceStats.min || 0),
        max: Number(priceStats.max || 0),
      },
    },
  };
}

module.exports = {
  isEnabled,
  indexProduct,
  removeProduct,
  bulkReindex,
  searchProducts,
  normalizeProduct,
};
