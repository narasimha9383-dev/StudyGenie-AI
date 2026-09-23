const buildKnowledgeGraph = (analysis = {}) => {
  const nodes = (analysis.concepts || []).slice(0, 24).map((concept) => ({ id: concept.term, label: concept.term, type: "concept", weight: concept.count || 1 }));
  const edges = (analysis.relationships || []).filter((edge) => edge.source && edge.target && edge.source !== edge.target).map((edge) => ({ source: edge.source, target: edge.target, type: edge.type || "related" }));
  return { version: "knowledge-graph-v1", nodes, edges, nodeCount: nodes.length, edgeCount: edges.length, generatedAt: new Date() };
};

module.exports = { buildKnowledgeGraph };
