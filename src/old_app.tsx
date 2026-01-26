import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar'
import Home from './pages/Home'
import MintConfirm from './pages/MintConfirm'
import Settings from './pages/Settings'
import Success from './pages/Success'
import AdminLayout from './admin/AdminLayout'
import OverviewPage from './admin/OverviewPage'
import SalesPage from './admin/SalesPage'
import WithdrawPage from './admin/WithdrawPage'
import BatchPage from './admin/BatchPage'
import MonitorPage from './admin/MonitorPage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <NavBar />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/valut_mint_nft/:hashCode" element={<MintConfirm />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/success" element={<Success />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route path="overview" element={<OverviewPage />} />
              <Route path="monitor" element={<MonitorPage />} />
              <Route path="sales" element={<SalesPage />} />
              <Route path="withdraw" element={<WithdrawPage />} />
              <Route path="batch" element={<BatchPage />} />
            </Route>
          </Routes>
        </main>
        <footer className="mx-auto max-w-7xl px-4 py-6 text-white/50 text-sm">
          Whale Vault © {new Date().getFullYear()}
        </footer>
      </div>
    </BrowserRouter>
  )
}
