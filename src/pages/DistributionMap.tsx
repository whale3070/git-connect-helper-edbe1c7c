// src/pages/DistributionMap.tsx
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const DistributionMap: React.FC = () => {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chartRef.current) {
      const myChart = echarts.init(chartRef.current);
      
      // 这里的 data 应该是从后端接口获取的
      // 格式：[{ name: '深圳', value: [114.05, 22.54, 1] }]
      const mapData: Array<{ name: string; value: [number, number, number] }> = [];

      myChart.setOption({
        backgroundColor: 'transparent',
        visualMap: {
          min: 0,
          max: 10,
          calculable: true,
          inRange: { color: ['#50a3ba', '#eac736', '#d94e5d'] }
        },
        geo: {
          map: 'china',
          roam: true,
          label: { emphasis: { show: false } },
          itemStyle: { areaColor: '#323c48', borderColor: '#404a59' }
        },
        series: [{
          name: 'Reader Density',
          type: 'heatmap',
          coordinateSystem: 'geo',
          data: mapData
        }]
      });
    }
  }, []);

  return <div ref={chartRef} style={{ width: '100%', height: '600px' }} />;
};

export default DistributionMap;
