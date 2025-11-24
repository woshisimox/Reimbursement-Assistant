import { NextResponse } from 'next/server';
import Tesseract from 'tesseract.js';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: '未提供有效的文件' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const { data } = await Tesseract.recognize(buffer, 'eng', {
      logger: () => {},
    });

    return NextResponse.json({ text: data.text });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'OCR 识别失败' }, { status: 500 });
  }
}
