import React from 'react'
import PeriodView from './PeriodView'
import YearlyBreakdownView from './YearlyBreakdownView'
import CategoryPivotView from './CategoryPivotView'
import WeeklyBreakdownView from './WeeklyBreakdownView'
import ParentChildrenView from './ParentChildrenView'

// Adapter per il block_type unificato 'view' (Builder semplificato, fase 1):
// smista verso i 5 componenti esistenti (mai riscritti) ricostruendo per
// ciascuno l'esatta `config` che già si aspettano — zero duplicazione della
// logica di rendering/chiamate API, già testata su period_view/yearly_breakdown/
// category_pivot/weekly_breakdown/parent_children_view.
function GenericView({ step, mod, schema, token, tableColumns, records, defaultModuleSlug }) {
  if (step.mode === 'children') {
    const config = {
      key: step.key, label: step.label, children_module: step.children_module,
      children_relation: step.children_relation, children_status_field: step.children_status_field,
      children_status_done_value: step.children_status_done_value, children_order_field: step.children_order_field,
      amount_field: step.amount_field, child_amount_field: step.child_amount_field,
    }
    return <ParentChildrenView config={config} mod={mod} schema={schema} token={token} tableColumns={tableColumns} records={records} />
  }

  if (step.mode === 'period' && !step.breakdown) {
    const config = {
      key: step.key, label: step.label, granularity: step.granularity, date_field: step.date_field,
      compare_previous: step.compare_previous, metrics: step.metrics || [], filters: step.filters || [],
    }
    return <PeriodView config={config} mod={mod} schema={schema} token={token} tableColumns={tableColumns} records={records} />
  }

  if (step.mode === 'period' && step.breakdown) {
    const config = {
      key: step.key, label: step.label, source_module: step.source_module, date_field: step.date_field,
      compare_previous_year: step.compare_previous, metrics: step.metrics || [], filters: step.filters || [],
    }
    return <YearlyBreakdownView config={config} defaultModuleSlug={defaultModuleSlug} token={token} />
  }

  if (step.mode === 'pivot') {
    const config = {
      key: step.key, label: step.label, source_module: step.source_module, date_field: step.date_field,
      group_by: step.group_by, metric_field: step.metric_field, metric_func: step.metric_func,
      metric_format: step.metric_format, n_years: step.n_years, filters: step.filters || [],
    }
    return <CategoryPivotView config={config} defaultModuleSlug={defaultModuleSlug} token={token} />
  }

  if (step.mode === 'simple') {
    const config = {
      key: step.key, label: step.label, source_module: step.source_module, date_field: step.date_field,
      metric_field: step.metric_field, metric_func: step.metric_func, metric_format: step.metric_format,
      threshold: step.threshold, filters: step.filters || [],
    }
    return <WeeklyBreakdownView config={config} defaultModuleSlug={defaultModuleSlug} token={token} />
  }

  return null
}

export default GenericView
