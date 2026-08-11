import { useState } from 'react'
import UpdateReport from './UpdateReport'
import AddExamsSheet from './AddExamsSheet'
import { GOLD } from './formStyles'

const INNER_TABS = [
  { k: 'app', label: 'App', hint: 'Upload a Learnyst CSV export' },
  { k: 'sheet', label: 'Sheet', hint: 'Enter attendance and scores manually' },
]

export default function AddExams({ studentList, teacherEmail, onInserted }) {
  const [innerTab, setInnerTab] = useState('app')

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex bg-gray-50 rounded-lg border border-gray-200 p-1 gap-1 w-fit">
        {INNER_TABS.map(({ k, label }) => (
          <button key={k} type="button" onClick={() => setInnerTab(k)}
            className="px-5 py-1.5 rounded-md text-sm font-medium transition"
            style={innerTab === k ? { background: GOLD, color: 'white' } : { color: 'var(--text)' }}
          >
            {label}
          </button>
        ))}
      </div>

      {innerTab === 'app'
        ? <UpdateReport studentList={studentList} teacherEmail={teacherEmail} onInserted={onInserted} />
        : <AddExamsSheet studentList={studentList} teacherEmail={teacherEmail} onInserted={onInserted} />}
    </div>
  )
}
