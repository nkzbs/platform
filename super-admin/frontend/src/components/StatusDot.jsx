import React from 'react'

function StatusDot({ status }) {
  const colors = {
    active: 'bg-cp-success',
    stopped: 'bg-gray-500',
    creating: 'bg-cp-warning animate-pulse',
    error: 'bg-cp-danger'
  }
  return <span className={'inline-block w-2 h-2 rounded-full ' + (colors[status] || 'bg-gray-500')} />
}

export default StatusDot
