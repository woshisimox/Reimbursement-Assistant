import { NextResponse } from 'next/server';
import Tesseract from 'tesseract.js';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: '未提供有效的文件' }, { status: 400 });
  }

  if (file.type?.toLowerCase() === 'application/pdf') {
    return NextResponse.json(
      { error: '当前内置 OCR 仅支持图片格式，请将 PDF 转成图片后再试，或接入外部 OCR/AI 服务。' },
      { status: 415 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const { data } = await Tesseract.recognize(buffer, 'chi_sim+eng', {
      logger: () => {},
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      workerPath: 'https://unpkg.com/tesseract.js@5.1.1/dist/worker.min.js',
      corePath: 'https://unpkg.com/tesseract.js-core@5.0.2/tesseract-core.wasm.js',
    });

    return NextResponse.json({ text: data.text });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          'OCR 识别失败：无法加载模型或识别出文本，请检查网络是否能访问 Tesseract 依赖，或改用外部 OCR/AI 服务。',
      },
      { status: 500 },
    );
  }
}
