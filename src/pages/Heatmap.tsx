import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';

const Heatmap: React.FC = () => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const initChart = async () => {
      if (!chartRef.current) return;

      // 1. 初始化 ECharts 实例
      const myChart = echarts.init(chartRef.current);

      try {
        // 2. 加载本地世界地图 JSON (已修复下载到 public 目录后的加载路径)
        // 路径使用 '/' 开头代表从 public 根目录读取
        const geoJsonRes = await fetch('/world.json');
        if (!geoJsonRes.ok) throw new Error("无法加载本地 world.json，请确认文件在 public 目录下");
        const worldGeoJson = await geoJsonRes.json();
        
        // 注册地图
        echarts.registerMap('world', worldGeoJson);

        // 3. 从您的 Go 后端获取热力图数据
        const dataRes = await fetch('http://198.55.109.102:8080/api/v1/analytics/distribution');
        const heatmapData = await dataRes.json();

        // 4. 配置 ECharts 选项
        const option: echarts.EChartsOption = {
          backgroundColor: '#0f172a', // 与 App.tsx 保持一致的深蓝底色
          title: {
            text: 'WHALE VAULT - 全球读者回响分布',
            left: 'center',
            top: '40',
            textStyle: {
              color: '#22d3ee',
              fontWeight: 'lighter',
              fontSize: 24
            }
          },
          tooltip: {
            show: true,
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            borderColor: '#22d3ee',
            textStyle: { color: '#fff' },
            formatter: (params: any) => {
                return `<div style="padding:5px">回响地点: ${params.name}</div>`;
            }
          },
          visualMap: {
            min: 0,
            max: 20,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: '50',
            inRange: {
              // 颜色跨度：深蓝 -> 电光青 -> 亮黄 -> 热力红 (代表回响强度)
              color: ['#0c4a6e', '#22d3ee', '#fbbf24', '#ef4444']
            },
            textStyle: { color: '#94a3b8' }
          },
          geo: {
            map: 'world',
            roam: true, // 允许读者缩放和拖拽
            emphasis: {
              itemStyle: { areaColor: '#1e293b' },
              label: { show: false }
            },
            itemStyle: {
              areaColor: '#111827', // 陆地颜色
              borderColor: '#334155', // 边界线颜色
              borderWidth: 0.8
            }
          },
          series: [
            {
              name: 'Readers',
              type: 'heatmap',
              coordinateSystem: 'geo',
              // 数据格式预期: [{name: "xxx", value: [lng, lat, count]}]
              data: heatmapData && heatmapData.length > 0 ? heatmapData : [], 
              pointSize: 12,
              blurSize: 18
            }
          ]
        };

        myChart.setOption(option);
        setLoading(false);

        // 响应式调整
        const handleResize = () => myChart.resize();
        window.addEventListener('resize', handleResize);

        return () => window.removeEventListener('resize', handleResize);

      } catch (error: any) {
        console.error('地图渲染异常:', error);
        setErrorMsg(error.message);
        setLoading(false);
      }
    };

    initChart();

    return () => {
      if (chartRef.current) {
        echarts.dispose(chartRef.current);
      }
    };
  }, []);

  return (
    <div className="w-full h-full relative flex items-center justify-center bg-[#0f172a]">
      {/* 加载状态指示器 */}
      {loading && (
        <div className="absolute z-10 flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mb-4"></div>
          <div className="text-cyan-400 animate-pulse font-mono text-sm tracking-widest">
            正在从 Arweave 节点同步读者确权数据...
          </div>
        </div>
      )}

      {/* 错误状态显示 */}
      {errorMsg && (
        <div className="absolute z-20 bg-red-900/20 border border-red-500/50 p-6 rounded-xl text-center">
          <p className="text-red-400 mb-2">回响地图同步失败</p>
          <p className="text-xs text-red-300/60 font-mono">{errorMsg}</p>
          <button 
            onClick={() => window.location.reload()}
            className="mt-4 text-xs bg-red-500/20 px-3 py-1 rounded hover:bg-red-500/40"
          >
            重试连接
          </button>
        </div>
      )}

      {/* 地图容器 */}
      <div 
        ref={chartRef} 
        className={`w-full h-full transition-opacity duration-1000 ${loading ? 'opacity-0' : 'opacity-100'}`} 
      />

      {/* 装饰性遮罩：底部渐变 */}
      <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-[#0f172a] to-transparent pointer-events-none" />
    </div>
  );
};

export default Heatmap;
