#!/usr/bin/env python3
import sys
import json
import os
import logging
import re
import contextlib

logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

def extract_json_from_text(text):
    try:
        text = text.strip()

        if "Loaded as API:" in text:
            json_start = text.find('{')
            if json_start != -1:
                json_str = text[json_start:]
                return json.loads(json_str)

        if text.startswith('{') and text.endswith('}'):
            return json.loads(text)

        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())

        return {"conteúdo": text}
    except Exception as e:
        logger.error(f"Erro ao extrair JSON: {e}")
        return {"conteúdo": text}

def create_prompt_from_payload(payload):
    tipo = payload.get('tipo', 'geração_de_lições')
    conteúdo_estudo = payload.get('conteúdo_estudo', '')
    nível_dificuldade = payload.get('nível_dificuldade', 'intermediário')
    notas_anteriores = payload.get('notas_anteriores', {})
    erros_anteriores = payload.get('erros_anteriores', [])
    histórico = payload.get('histórico', [])
    próximos_conteúdos = payload.get('próximos_conteúdos', [])
    outras_informações = payload.get('outras_informações', {})

    base_prompt = "Você é o ASS (AI Studying Service), um sistema educacional avançado que cria conteúdo personalizado exclusivamente em JSON. Regras: 1) Sempre retorne JSON válido 2) Use apenas estruturas pré-definidas 3) Não inclua texto fora do JSON 4) Adapte conteúdo ao nível de dificuldade. "

    if tipo == 'questionamento':
        has_material = outras_informações.get('has_material', False)
        material_instruction = " IMPORTANTE: Há um material didático anexado. As perguntas devem ser baseadas diretamente no conteúdo do material didático fornecido, testando a compreensão dos conceitos apresentados no material." if has_material else ""
        base_prompt += f"Para 'questionamento' sobre '{conteúdo_estudo}' no nível '{nível_dificuldade}', {material_instruction} retorne: {{'perguntas': [{{'pergunta': 'texto detalhado e claro', 'opções': ['A) opção completa A', 'B) opção completa B', 'C) opção completa C', 'D) opção completa D'], 'resposta_correta': 'A/B/C/D'}}]}}. Crie {outras_informações.get('question_count', 5)} perguntas com 4 opções cada. As respostas corretas devem ser distribuídas aleatoriamente. Dificuldade: Iniciante=conceitos básicos, Intermediário=aplicação prática, Avançado=análise crítica."
    elif tipo == 'geração_de_lições':
        user_stats = outras_informações.get('user_stats', {})
        user_level = outras_informações.get('user_level', 'beginner')
        has_material = outras_informações.get('has_material', False)
        material_instruction = " IMPORTANTE: Há um material didático anexado. Use o conteúdo do material didático como referência principal. A lição deve explicar e expandir os conceitos presentes no material, garantindo que o aluno compreenda profundamente o conteúdo fornecido." if has_material else ""
        base_prompt += f"Para 'geração_de_lições' sobre '{conteúdo_estudo}' no nível '{nível_dificuldade}', considere: usuário nível {user_level}, nota média {user_stats.get('avg_score', 0)}%, {user_stats.get('total_assessments', 0)} avaliações realizadas. {material_instruction} Retorne: {{'lição': 'texto detalhado e completo com pelo menos 500 palavras cobrindo todos os aspectos fundamentais do tema. Estruture com introdução, desenvolvimento detalhado com subtópicos claros, exemplos práticos integrados no texto, e conclusão.', 'exemplos': ['exemplo 1 detalhado e relevante com explicação clara', 'exemplo 2 detalhado e relevante com explicação clara', 'exemplo 3 detalhado e relevante com explicação clara'], 'exercícios': ['exercício 1 prático e relacionado com contexto', 'exercício 2 prático e relacionado com contexto'], 'objetivos': ['objetivo 1 claro e mensurável', 'objetivo 2 claro e mensurável', 'objetivo 3 claro e mensurável'], 'resumo': 'resumo conciso de 100-150 palavras destacando os pontos principais'}}. Estruture: introdução conceitual, desenvolvimento detalhado, exemplos práticos, exercícios progressivos, resumo conclusivo. Iniciante=fundamentos básicos, Intermediário=aplicações práticas, Avançado=aprofundamento teórico e crítico."
    elif tipo == 'provas':
        has_material = outras_informações.get('has_material', False)
        material_instruction = " IMPORTANTE: Há um material didático anexado. As perguntas da prova devem avaliar profundamente o conhecimento do conteúdo do material didático fornecido, cobrindo desde conceitos fundamentais até aplicações avançadas." if has_material else ""
        base_prompt += f"Para 'provas' sobre '{conteúdo_estudo}' no nível '{nível_dificuldade}', {material_instruction} retorne: {{'perguntas': [{{'pergunta': 'texto detalhado e desafiador', 'opções': ['A) opção completa A', 'B) opção completa B', 'C) opção completa C', 'D) opção completa D'], 'resposta_correta': 'A/B/C/D'}}], 'instruções': 'texto com orientações'}}. Crie {outras_informações.get('question_count', 10)} perguntas abrangentes. Inclua 30% questões fáceis (conceitos), 50% médias (aplicação), 20% difíceis (análise)."
    elif tipo == 'geração_de_plano_estudo':
        generate_tag = outras_informações.get('generate_tag', False)
        has_material = outras_informações.get('has_material', False)
        tag_instruction = " Gere também uma 'tag' única e padronizada para categorização (ex: #iluminismo, #python-basico, #calculo-diferencial)." if generate_tag else ""
        material_instruction = " IMPORTANTE: Há um material didático anexado. Use o conteúdo do material didático como base principal para criar os tópicos. Os tópicos devem seguir a estrutura e sequência do material fornecido, garantindo que todo o conteúdo relevante seja coberto de forma progressiva e organizada." if has_material else ""
        base_prompt += (
            f"Para 'geração_de_plano_estudo' sobre '{conteúdo_estudo}', retorne: "
            "{{'tópicos': [{{'nome': 'nome tópico específico', 'descrição': 'descrição detalhada do conteúdo', 'dificuldade': 'beginner/intermediate/advanced'}}]"
            f"{', \"tag\": \"tag_gerada\"' if generate_tag else ''}"
            "}}. "
            f"{material_instruction}"
            "Crie 8-12 tópicos progressivos cobrindo: fundamentos (20%), conceitos centrais (40%), "
            "aplicações (30%), tópicos avançados (10%). Cada tópico deve ser independente e progressivo."
            f"{tag_instruction}"
    )
    elif tipo == 'sumarização_de_erros':
        question_explanations = outras_informações.get('question_explanations', [])
        base_prompt += f"Para 'sumarização_de_erros' sobre erros em '{conteúdo_estudo}', analise {len(question_explanations)} questões. Para cada questão errada, forneça: explicação detalhada do conceito, por que a resposta correta é a certa, por que a resposta do usuário está errada (se aplicável), e dicas para evitar esse erro no futuro. Retorne: {{'erros_comuns': ['erro 1 específico identificado com explicação detalhada', 'erro 2 específico identificado com explicação detalhada'], 'soluções': ['solução 1 detalhada e prática com passo a passo', 'solução 2 detalhada e prática com passo a passo'], 'recomendações': ['recomendação 1 específica para melhoria com recursos sugeridos', 'recomendação 2 específica para melhoria com recursos sugeridos'], 'explicações_detalhadas': [{{'questão': 'texto da questão', 'explicação': 'explicação completa do conceito', 'dica_estudo': 'dica específica para esse tópico'}}]}}. Analise padrões de erro e forneça correções específicas e acionáveis."
    elif tipo == 'ajuda':
        contexto = outras_informações.get('contexto', {})
        user_stats = outras_informações.get('user_stats', {})
        ajuda_restante = outras_informações.get('ajuda_restante', 0)
        base_prompt += f"Para 'ajuda' durante {contexto.get('tipo_sessao', 'estudo')} sobre '{conteúdo_estudo}'. Contexto completo: {json.dumps(contexto)}. Estatísticas do usuário: {json.dumps(user_stats)}. Ajudas restantes: {ajuda_restante}. Regras: 1) Se for durante prova, NÃO dê respostas diretas 2) Se for simulado, máximo {ajuda_restante} ajudas por sessão 3) Dê dicas objetivas sem revelar respostas 4) Foque no conteúdo específico 5) Considere o nível e histórico do usuário. Retorne: {{'resposta': 'resposta objetiva e útil como dica contextualizada', 'tipo': 'dica'}}."

    if erros_anteriores:
        base_prompt += f" Erros anteriores do aluno: {json.dumps(erros_anteriores)}"

    if notas_anteriores:
        base_prompt += f" Desempenho anterior: {json.dumps(notas_anteriores)}"

    base_prompt += " Retorne APENAS o JSON válido sem texto adicional."

    return base_prompt

@contextlib.contextmanager
def suppress_stdout_stderr():
    with open(os.devnull, 'w') as devnull:
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        try:
            sys.stdout = devnull
            sys.stderr = devnull
            yield
        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr

def process_ai_request(payload):
    try:
        prompt = create_prompt_from_payload(payload)

        from google import genai
        from google.genai import types

        GEMINI_TOKEN = os.getenv('GEMINI_API_KEY')
        if not GEMINI_TOKEN:
            return {"error": "GEMINI_API_KEY não configurado"}

        with suppress_stdout_stderr():
            client = genai.Client(api_key=GEMINI_TOKEN)

            model = "gemini-2.5-flash"
            contents = [
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_text(text=prompt),
                    ],
                ),
            ]


            generate_content_config = types.GenerateContentConfig(
                temperature=0.7,
                top_p=0.95,
                max_output_tokens=8192,
            )


            response = client.models.generate_content(
                model=model,
                contents=contents,
                config=generate_content_config
            )

            response_text = response.text

        json_response = extract_json_from_text(response_text)
        return json_response

    except ImportError:
        return {"error": "Biblioteca google-genai não instalada"}
    except Exception as e:
        logger.error(f"Erro na comunicação com Gemini: {e}")
        return {"error": f"Erro na comunicação com Gemini: {str(e)}"}

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Payload não fornecido"}))
        sys.exit(1)

    try:
        payload_str = sys.argv[1]
        payload = json.loads(payload_str)

        result = process_ai_request(payload)
        print(json.dumps(result))

    except Exception as e:
        error_result = {"error": f"Erro no serviço Python: {str(e)}"}
        print(json.dumps(error_result))
        sys.exit(1)