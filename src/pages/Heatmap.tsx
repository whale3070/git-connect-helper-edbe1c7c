import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';

const Heatmap: React.FC = () => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initChart = async () => {
      if (!chartRef.current) return;

      // 1. 初始化 ECharts 实例
      const myChart = echarts.init(chartRef.current);

      try {
        // 2. 加载世界地图 JSON (解决地图不显示的关键)
        // 使用公开 CDN 加载世界地图数据
        const geoJsonRes = await fetch('https://raw.githubusercontent.com/apache/echarts/master/test/data/map/json/world.json');
        const worldGeoJson = await geoJsonRes.json();
        
        // 注册地图
        echarts.registerMap('world', worldGeoJson);

        // 3. 从你的 Go 后端获取热力图数据
        // 注意：请确保 IP 地址是你服务器的真实内网或公网 IP
        const dataRes = await fetch('http://192.168.47.130:8080/api/v1/analytics/distribution');
        const heatmapData = await dataRes.json();

        // 4. 配置 ECharts
        const option: echarts.EChartsOption = {
          backgroundColor: '#0f172a', // 与你的 App.tsx 背景色保持一致
          title: {
            text: 'WHALE VAULT - 读者分布回响图',
            left: 'center',
            top: '20',
            textStyle: {
              color: 'rgba(255,255,255,0.8)',
              fontWeight: 'lighter',
              letterSpacing: 2
            }
          },
          tooltip: {
            show: true,
            formatter: (params: any) => {
                return `地点: ${params.name}`;
            }
          },
          visualMap: {
            min: 0,
            max: 10,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: '20',
            inRange: {
              // 颜色跨度：从深蓝到电光青，最后到热力红
              color: ['#003366', '#00ffcc', '#ffff00', '#ff3333']
            },
            textStyle: { color: '#fff' }
          },
          geo: {
            map: 'world',
            roam: true, // 允许缩放和拖拽
            emphasis: {
              itemStyle: { areaColor: '#1e293b' },
              label: { show: false }
            },
            itemStyle: {
              areaColor: '#1a1d23', // 陆地颜色
              borderColor: '#334155', // 边界线颜色
              borderWidth: 1
            }
          },
          series: [
            {
              name: 'Readers',
              type: 'heatmap',
              coordinateSystem: 'geo',
              data: heatmapData || [], // 后端数据: [{name: "Ashburn", value: [-77.5, 39.03, 1]}]
              pointSize: 10,
              blurSize: 15
            }
          ]
        };

        myChart.setOption(option);
        setLoading(false);

        // 响应式调整
        window.addEventListener('resize', () => myChart.resize());

      } catch (error) {
        console.error('地图初始化失败:', error);
        setLoading(false);
      }
    };

    initChart();

    return () => {
      // 销毁实例
      if (chartRef.current) {
        echarts.dispose(chartRef.current);
      }
    };
  }, []);

  return (
    <div className="w-full h-screen flex flex-col items-center justify-center">
      {loading && (
        <div className="absolute z-10 text-cyan-400 animate-pulse">
          正在从 Arweave 节点同步地理数据...
        </div>
      )}
      <div 
        ref={chartRef} 
        className="w-full h-full" 
        style={{ minHeight: '600px' }}
      />
    </div>
  );
};

export default Heatmap;
