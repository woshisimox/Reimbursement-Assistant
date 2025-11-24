import { NextRequest, NextResponse } from 'next/server';

interface AiRequestBody {
  provider: 'openai' | 'custom';
  model: string;
  endpoint?: string;
  apiKey: string;
  prompt: string;
  receipts: Array<{
    name: string;
    category: string;
    status: string;
    amount: string;
    date: string;
    notes: string[];
    rawText: string;
  }>;
  images?: Array<{ name: string; dataUrl: string; hint?: string }>;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<AiRequestBody>;
  const { provider, model, endpoint, apiKey, prompt, receipts, images } = body;

  if (!provider || !model || !apiKey || !prompt) {
    return NextResponse.json({ error: '缺少必要参数（provider/model/apiKey/prompt）。' }, { status: 400 });
  }

  const openAiEndpoint = endpoint && provider === 'openai' ? endpoint : 'https://api.openai.com/v1/chat/completions';
  const finalEndpoint = provider === 'openai' ? openAiEndpoint : endpoint;
  if (!finalEndpoint) {
    return NextResponse.json({ error: '请填写可用的 AI Endpoint。' }, { status: 400 });
  }

  const systemPrompt =
    '你是发票报销助手，收到的 prompt 和票据 JSON 描述了用户上传的发票。若提供了票据图片，请先对图片执行 OCR，再结合 prompt 与 JSON 进行整理，最终按报销顺序输出 JSON，并标出缺失材料提醒。';

  const receiptJson = JSON.stringify(receipts ?? [], null, 2);

  const imageMessages = (images ?? [])
    .filter((img) => !!img.dataUrl)
    .map((img) => ({
      role: 'user',
      content: [
        { type: 'text', text: `票据图片：${img.name}。${img.hint ? `OCR 文本：${img.hint}` : '请直接从图片识别。'}` },
        { type: 'image_url', image_url: { url: img.dataUrl } },
      ],
    }));

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
    {
      role: 'user',
      content: `票据 JSON：${receiptJson}\n请结合 JSON 与图片逐张 OCR 并输出最终报销清单。`,
    },
    ...imageMessages,
  ];

  try {
    const response = await fetch(finalEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        { error: result?.error?.message ?? '外部 AI 请求失败，请检查 API Key、模型或 Endpoint 设置。' },
        { status: response.status },
      );
    }

    const content = result?.choices?.[0]?.message?.content ?? JSON.stringify(result, null, 2);
    return NextResponse.json({ content });
  } catch (error) {
    const message = error instanceof Error ? error.message : '外部 AI 请求异常，请稍后重试。';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
