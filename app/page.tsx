'use client';

import { useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

type ReceiptCategory =
  | '出发机票'
  | '返程机票'
  | '住宿'
  | '火车/高铁'
  | '打车/用车'
  | '餐饮'
  | '其他';

type ReceiptStatus = '待识别' | '识别中' | '已完成' | '识别失败';

interface Receipt {
  id: string;
  name: string;
  preview?: string;
  status: ReceiptStatus;
  rawText?: string;
  category?: ReceiptCategory;
  amount?: string;
  date?: string;
  notes?: string[];
}

const CATEGORY_ORDER: ReceiptCategory[] = [
  '出发机票',
  '住宿',
  '打车/用车',
  '火车/高铁',
  '餐饮',
  '返程机票',
  '其他',
];

const CATEGORY_HINTS: Record<ReceiptCategory, string> = {
  出发机票: '常见字段：始发地、目的地、航班号、出票时间',
  返程机票: '常见字段：返程航班、航站楼、航班号、落地时间',
  住宿: '常见字段：入住/离店时间、酒店名称、房型、房号、金额',
  '火车/高铁': '常见字段：车次、座位、出发/到达站、开车时间',
  '打车/用车': '常见字段：出发/到达地点、行程时长、金额',
  餐饮: '常见字段：就餐日期、人数、金额、店铺名',
  其他: '其他费用类发票',
};

function inferCategory(text: string): ReceiptCategory {
  if (/(去程|depart|outbound|去程|航班|boarding pass)/i.test(text) || /flight/i.test(text)) {
    if (/return|返程|回程/i.test(text)) {
      return '返程机票';
    }
    return '出发机票';
  }

  if (/返程|回程|返航|return flight/i.test(text)) {
    return '返程机票';
  }

  if (/hotel|住宿|入住|离店|宾馆/i.test(text)) {
    return '住宿';
  }

  if (/train|高铁|动车|火车|rail/i.test(text)) {
    return '火车/高铁';
  }

  if (/taxi|ride|打车|网约车|滴滴|专车|快车/i.test(text)) {
    return '打车/用车';
  }

  if (/meal|餐饮|午餐|晚餐|早餐|就餐|餐费|餐厅/i.test(text)) {
    return '餐饮';
  }

  return '其他';
}

function extractAmount(text: string): string | undefined {
  const amountMatch = text.match(/(?:￥|¥|RMB|CNY)?\s*([0-9]{1,4}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
  return amountMatch?.[1];
}

function extractDate(text: string): string | undefined {
  const dateMatch = text.match(/(20[0-9]{2}[./-][01]?[0-9][./-][0-3]?[0-9])/);
  return dateMatch?.[1];
}

function buildItinerary(receipts: Receipt[]) {
  const sorted = [...receipts].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category ?? '其他') - CATEGORY_ORDER.indexOf(b.category ?? '其他'),
  );

  const missing: string[] = [];
  const categories = new Set(sorted.map((r) => r.category));
  if (categories.has('返程机票') && !categories.has('出发机票')) {
    missing.push('已检测到返程机票，建议补齐出发机票以完善行程。');
  }
  if ((categories.has('出发机票') || categories.has('火车/高铁')) && !categories.has('住宿')) {
    missing.push('检测到出行凭证但缺少住宿发票，可提示用户补充酒店发票。');
  }
  if ((categories.has('出发机票') || categories.has('返程机票')) && !categories.has('打车/用车')) {
    missing.push('考虑补充往返机场的打车或用车发票。');
  }

  return { sorted, missing };
}

async function runOcr(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/ocr', {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw new Error('OCR 识别失败');
  }
  const result = await response.json();
  return result.text as string;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [insights, setInsights] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const { sorted: sortedReceipts, missing } = useMemo(() => buildItinerary(receipts), [receipts]);

  const handleDrop = (files: FileList | null) => {
    if (!files) return;
    startUpload(Array.from(files));
  };

  const startUpload = async (files: File[]) => {
    setIsUploading(true);
    const draft = files.map<Receipt>((file) => ({
      id: uuidv4(),
      name: file.name,
      status: '识别中',
      preview: URL.createObjectURL(file),
    }));
    setReceipts((prev) => [...prev, ...draft]);

    const newInsights: string[] = [];

    await Promise.all(
      draft.map(async (entry, idx) => {
        try {
          const text = await runOcr(files[idx]);
          const category = inferCategory(text);
          const amount = extractAmount(text);
          const date = extractDate(text);
          const notes: string[] = [];

          if (!amount) notes.push('未识别到金额，请人工确认。');
          if (!date) notes.push('未识别到日期，请确认开票时间。');

          setReceipts((prev) =>
            prev.map((r) =>
              r.id === entry.id
                ? {
                    ...r,
                    status: '已完成',
                    rawText: text,
                    category,
                    amount,
                    date,
                    notes,
                  }
                : r,
            ),
          );
        } catch (error) {
          console.error(error);
          const advice = '有发票识别失败，请检查文件清晰度或改用 PDF 上传。';
          newInsights.push(advice);
          setReceipts((prev) => prev.map((r) => (r.id === entry.id ? { ...r, status: '识别失败' } : r)));
        }
      }),
    );

    setInsights((prev) => [...prev, ...newInsights]);
    setIsUploading(false);
  };

  return (
    <main style={{ padding: '2rem 1.5rem', display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 1080, width: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="tag">智能OCR</div>
            <div className="tag">报销顺序整理</div>
            <div className="tag">缺失提醒</div>
          </div>
          <h1 style={{ fontSize: '2.2rem', margin: 0 }}>一键上传发票，自动整理报销清单</h1>
          <p style={{ margin: 0, color: 'var(--muted)', maxWidth: 720 }}>
            支持住宿、打车、飞机、火车、餐饮等多种发票类型。系统通过 OCR 识别关键信息，
            自动生成符合行程的报销顺序，并提示缺失材料。
          </p>
        </header>

        <section className="card" style={{ padding: '1.25rem', display: 'flex', gap: '1rem' }}>
          <div style={{ flex: 1, border: '1px dashed var(--border)', borderRadius: '0.75rem', padding: '1rem' }}>
            <p style={{ marginTop: 0, color: 'var(--muted)' }}>
              拖拽或点击上传发票（图片/PDF），系统将自动识别并整理行程。
            </p>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(e.dataTransfer.files);
              }}
              style={{
                border: '1px dashed var(--border)',
                padding: '1rem',
                borderRadius: '0.75rem',
                background: '#f8fafc',
                textAlign: 'center',
              }}
            >
              <p style={{ margin: 0 }}>拖拽文件到此处</p>
              <p style={{ margin: '0.35rem 0', color: 'var(--muted)', fontSize: '0.9rem' }}>或</p>
              <button className="button" onClick={() => inputRef.current?.click()} disabled={isUploading}>
                选择文件
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/*,.pdf"
                style={{ display: 'none' }}
                onChange={(e) => handleDrop(e.target.files)}
              />
            </div>
            <p style={{ marginBottom: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>
              提示：可一次上传多张发票，系统将自动识别类型并按照出差行程顺序排布。
            </p>
          </div>
          <div style={{ flexBasis: 320, display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <div className="card" style={{ padding: '0.9rem' }}>
              <h3 style={{ margin: '0 0 0.5rem' }}>智能整理逻辑</h3>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                <li>OCR 提取航班 / 车次 / 酒店 / 金额 / 日期等字段</li>
                <li>按行程顺序排序：去程 → 住宿 → 当地交通 → 返程</li>
                <li>缺失提醒：如缺少去程机票、住宿或打车凭证</li>
                <li>生成报销备注：金额未识别、日期缺失时提示人工确认</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h2 style={{ margin: 0 }}>报销行程</h2>
            <span className="tag">已排序</span>
          </div>
          {sortedReceipts.length === 0 ? (
            <p style={{ color: 'var(--muted)', margin: 0 }}>还没有上传发票，上传后会自动生成行程顺序。</p>
          ) : (
            <ol style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {sortedReceipts.map((receipt) => (
                <li key={receipt.id} className="card" style={{ padding: '0.9rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <strong>{receipt.name}</strong>
                        {receipt.category && <span className="tag">{receipt.category}</span>}
                        <span className="tag" style={{ background: '#ecfeff', color: '#0ea5e9', borderColor: '#bae6fd' }}>
                          {receipt.status}
                        </span>
                      </div>
                      <p style={{ margin: 0, color: 'var(--muted)' }}>
                        金额：{receipt.amount ?? '待确认'} ｜ 日期：{receipt.date ?? '待确认'}
                      </p>
                      {receipt.rawText && (
                        <details>
                          <summary style={{ cursor: 'pointer', color: '#2563eb' }}>查看OCR内容</summary>
                          <pre
                            style={{
                              background: '#f8fafc',
                              padding: '0.75rem',
                              borderRadius: '0.5rem',
                              whiteSpace: 'pre-wrap',
                              border: '1px solid var(--border)',
                            }}
                          >
                            {receipt.rawText}
                          </pre>
                        </details>
                      )}
                      {receipt.notes && receipt.notes.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {receipt.notes.map((note) => (
                            <span key={note} className="tag" style={{ background: '#fff7ed', color: '#c2410c', borderColor: '#fed7aa' }}>
                              {note}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {receipt.preview && (
                      <img
                        src={receipt.preview}
                        alt={receipt.name}
                        style={{ width: 140, height: 'auto', borderRadius: '0.5rem', border: '1px solid var(--border)' }}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {missing.length > 0 && (
            <div className="card" style={{ padding: '0.85rem', background: '#fefce8', borderColor: '#facc15' }}>
              <strong>缺失提醒：</strong>
              <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', color: 'var(--muted)' }}>
                {missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card" style={{ padding: '1.25rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <h3 style={{ marginTop: 0 }}>分类提示</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
              {CATEGORY_ORDER.map((category) => (
                <div key={category} className="card" style={{ padding: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <strong>{category}</strong>
                    <span className="tag">识别优先</span>
                  </div>
                  <p style={{ margin: '0.4rem 0 0', color: 'var(--muted)', fontSize: '0.95rem' }}>{CATEGORY_HINTS[category]}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>系统建议</h3>
            <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--muted)', lineHeight: 1.7 }}>
              <li>若票据模糊，可转为 PDF 后再上传，提升 OCR 精度。</li>
              <li>同一行程建议一次性上传，系统可自动排序并检查缺失。</li>
              <li>对金额、日期未识别的票据，将标记提醒人工确认。</li>
              <li>可根据航班/车次时间，进一步匹配打车发票的时间合理性。</li>
              <li>支持导出整理结果，可结合财务模板生成报销单。</li>
            </ul>
            {insights.length > 0 && (
              <div className="card" style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f8fafc' }}>
                <strong>实时提醒</strong>
                <ul style={{ margin: '0.45rem 0 0', paddingLeft: '1.1rem', color: 'var(--muted)' }}>
                  {insights.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
