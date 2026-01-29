import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as echarts from 'echarts';
import { BACKEND_URL } from '../config/backend';
import { RefreshCw } from 'lucide-react';

const POLL_INTERVAL = 5000; // 5秒轮询一次

const Heatmap: React.FC = () => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [totalReaders, setTotalReaders] = useState<number>(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // 获取热力图数据
  const fetchHeatmapData = useCallback(async () => {
    try {
      const dataRes = await fetch(`${BACKEND_URL}/api/v1/analytics/distribution`);
      if (!dataRes.ok) throw new Error('获取数据失败');
      const heatmapData = await dataRes.json();
      
      // 计算总读者数
      const total = heatmapData.reduce((sum: number, item: any) => {
        const count = item.value?.[2] || 0;
        return sum + count;
      }, 0);
      setTotalReaders(total);
      setLastUpdate(new Date());
      
      return heatmapData;
    } catch (error) {
      console.error('获取热力图数据失败:', error);
      return null;
    }
  }, []);

  // 更新图表数据
  const updateChartData = useCallback(async () => {
    if (!chartInstance.current) return;
    
    const newData = await fetchHeatmapData();
    if (newData) {
      chartInstance.current.setOption({
        series: [
          { data: newData },
          { data: newData }
        ]
      });
    }
  }, [fetchHeatmapData]);

  useEffect(() => {
    const initChart = async () => {
      if (!chartRef.current) return;

      // 1. 初始化 ECharts 实例
      chartInstance.current = echarts.init(chartRef.current);

      try {
        // 2. 加载世界地图 JSON
        const geoJsonRes = await fetch('/world.json');
        if (!geoJsonRes.ok) throw new Error("无法加载 world.json");
        const worldGeoJson = await geoJsonRes.json();
        
        echarts.registerMap('world', worldGeoJson);

        // 3. 获取初始热力图数据
        const heatmapData = await fetchHeatmapData();

        // 4. 配置 ECharts 选项
        const option: echarts.EChartsOption = {
          backgroundColor: '#0f172a',
          title: {
            text: '🐋 WHALE VAULT - 全球读者回响分布',
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
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: '#22d3ee',
            textStyle: { color: '#fff' },
            formatter: (params: any) => {
              const count = params.value?.[2] || 0;
              return `<div style="padding:8px">
                <div style="font-weight:bold;margin-bottom:4px">${params.name}</div>
                <div style="color:#22d3ee">📖 ${count} 位读者已点亮</div>
              </div>`;
            }
          },
          visualMap: {
            min: 0,
            max: 50,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: '50',
            inRange: {
              color: ['#0c4a6e', '#22d3ee', '#fbbf24', '#ef4444']
            },
            textStyle: { color: '#94a3b8' }
          },
          geo: {
            map: 'world',
            roam: true,
            emphasis: {
              itemStyle: { areaColor: '#1e293b' },
              label: { show: false }
            },
            itemStyle: {
              areaColor: '#111827',
              borderColor: '#334155',
              borderWidth: 0.8
            }
          },
          series: [
            {
              name: 'Readers',
              type: 'effectScatter',
              coordinateSystem: 'geo',
              data: heatmapData || [],
              symbolSize: (val: any) => Math.max(10, Math.min(30, (val[2] || 1) * 5)),
              showEffectOn: 'render',
              rippleEffect: {
                brushType: 'stroke',
                scale: 3,
                period: 4
              },
              itemStyle: {
                color: '#22d3ee',
                shadowBlur: 10,
                shadowColor: '#22d3ee'
              },
              zlevel: 1
            },
            {
              name: 'ReaderPoints',
              type: 'scatter',
              coordinateSystem: 'geo',
              data: heatmapData || [],
              symbolSize: (val: any) => Math.max(6, Math.min(20, (val[2] || 1) * 3)),
              itemStyle: {
                color: '#fbbf24',
                opacity: 0.8
              },
              zlevel: 2
            }
          ]
        };

        chartInstance.current.setOption(option);
        setLoading(false);

        // 响应式调整
        const handleResize = () => chartInstance.current?.resize();
        window.addEventListener('resize', handleResize);

        return () => window.removeEventListener('resize', handleResize);

      } catch (error: any) {
        console.error('地图渲染异常:', error);
        setErrorMsg(error.message);
        setLoading(false);
      }
    };

    initChart();

    // 设置轮询更新
    const pollInterval = setInterval(updateChartData, POLL_INTERVAL);

    return () => {
      clearInterval(pollInterval);
      if (chartInstance.current) {
        chartInstance.current.dispose();
        chartInstance.current = null;
      }
    };
  }, [fetchHeatmapData, updateChartData]);

  return (
    <div className="w-full h-full relative flex items-center justify-center bg-[#0f172a]">
      {/* 实时统计面板 */}
      <div className="absolute top-4 right-4 z-20 bg-slate-900/80 backdrop-blur-sm border border-cyan-500/30 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2 text-cyan-400">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="text-xs uppercase tracking-wider">实时更新中</span>
        </div>
        <div className="text-3xl font-black text-white">{totalReaders}</div>
        <div className="text-[10px] text-gray-400 uppercase">全球已点亮读者</div>
        {lastUpdate && (
          <div className="text-[9px] text-gray-500">
            更新于 {lastUpdate.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* 加载状态指示器 */}
      {loading && (
        <div className="absolute z-10 flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mb-4"></div>
          <div className="text-cyan-400 animate-pulse font-mono text-sm tracking-widest">
            正在从 Conflux 链同步读者确权数据...
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

      {/* 装饰性遮罩 */}
      <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-[#0f172a] to-transparent pointer-events-none" />
    </div>
  );
};

export default Heatmap;