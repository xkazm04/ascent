export function PreviewGraph() {
  return (
    <svg viewBox="0 0 320 180">
      <g stroke="currentColor" opacity=".3">
        <path d="M65 50L160 90 255 40M160 90L255 140M65 140L160 90" fill="none" />
      </g>
      {(
        [
          [65, 50],
          [160, 90],
          [255, 40],
          [255, 140],
          [65, 140],
        ] as const
      ).map(([x, y], i) => (
        <g key={i}>
          <rect x={x - 30} y={y - 16} width="60" height="32" rx="7" fill={i === 1 ? "#b5a2f4" : "#34363c"} />
          <circle cx={x - 16} cy={y} r="3" fill="#92d6bc" />
          <path d={`M${x - 7} ${y}h23`} stroke={i === 1 ? "#282331" : "#81838e"} />
        </g>
      ))}
    </svg>
  );
}
