'use client';

// Animated pulse skeleton
const Bone = ({ w, h, r, className = '' }) => (
  <div className={`animate-pulse bg-slate-200 rounded ${className}`}
    style={{ width: w || '100%', height: h || 16, borderRadius: r || 8 }} />
);

// Full dashboard skeleton
export function DashboardSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1,2,3,4].map(i => (
          <div key={i} className="bg-white rounded-xl p-5 border-l-4 border-l-slate-200">
            <Bone w={80} h={10} />
            <Bone w={120} h={32} className="mt-3" />
            <Bone w={60} h={10} className="mt-2" />
          </div>
        ))}
      </div>
      {/* Treasury Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1,2,3,4].map(i => (
          <div key={i} className="bg-white rounded-xl p-5 border-l-4 border-l-slate-200">
            <Bone w={60} h={10} />
            <Bone w={100} h={28} className="mt-3" />
          </div>
        ))}
      </div>
      {/* Table skeleton */}
      <div className="bg-white rounded-xl p-4">
        <Bone w={200} h={20} className="mb-4" />
        {[1,2,3,4,5].map(i => (
          <div key={i} className="flex gap-4 mb-3">
            <Bone w={80} h={14} />
            <Bone h={14} />
            <Bone w={100} h={14} />
            <Bone w={80} h={14} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Table skeleton
export function TableSkeleton({ rows = 8, cols = 5 }) {
  return (
    <div className="bg-white rounded-xl p-4">
      <div className="flex justify-between mb-4">
        <Bone w={180} h={22} />
        <Bone w={100} h={30} r={8} />
      </div>
      <div className="space-y-2.5">
        {/* Header */}
        <div className="flex gap-3 pb-2 border-b">
          {Array(cols).fill(0).map((_, i) => <Bone key={i} h={12} />)}
        </div>
        {/* Rows */}
        {Array(rows).fill(0).map((_, i) => (
          <div key={i} className="flex gap-3 py-1.5">
            {Array(cols).fill(0).map((_, j) => <Bone key={j} h={14} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

// Card grid skeleton
export function CardGridSkeleton({ count = 8 }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {Array(count).fill(0).map((_, i) => (
        <div key={i} className="bg-white rounded-lg p-4 border border-slate-200">
          <Bone w={120} h={16} />
          <Bone w={80} h={10} className="mt-2" />
          <div className="flex justify-between mt-3">
            <Bone w={60} h={14} />
            <Bone w={50} h={14} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Single line skeleton for inline loading
export function InlineSkeleton({ w = 100 }) {
  return <Bone w={w} h={14} className="inline-block" />;
}

export default { DashboardSkeleton, TableSkeleton, CardGridSkeleton, InlineSkeleton };
