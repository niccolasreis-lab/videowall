# Verificação operacional — 03/11/2026

A versão está ativa para revisão local em `http://127.0.0.1:3210/`. Nenhuma publicação ou comando de atualização foi enviado aos pontos reais. A implementação preserva os temas de cartaz e os templates anteriores do workspace.

## Testes e dados

- Suíte existente e novos fluxos: **70 testes aprovados**, sem falhas. Cobrem migração, CSV/Toledo, nomes comerciais, restauração dos preços da origem, oferta/clube ausentes, ativação manual, fotos, subplaylists repetidas/circulares/agendadas, limite de 500 itens, snapshots, Tabela Online, autorização, filtros, segmentos idempotentes e dias históricos de 23/25 horas.
- As 21 verificações de sintaxe do comando `check` passaram. Após a última correção de navegação, a sintaxe e os dois testes de formulário de ponto passaram novamente.
- A instância isolada usou cópia consistente do SQLite e uploads, na porta 3212. Os conteúdos e a publicação de validação foram criados somente nessa cópia.
- Backup anterior à ativação: `backups/before-operational-activation-2026-11-03.sqlite`. Comparação por SHA-256 de todas as colunas preexistentes confirmou preservação de catálogo (906), conteúdos virtuais (3), playlists (3), pontos (3), publicações (6), mídias (5), imagens do banco (6.920), arquivos únicos (6.248), consultas (1.829) e termos solicitados (4.457).
- A importação foi pausada antes do backup e reinício. A busca automática foi reativada; após reconexão do usuário, a interface confirmou novos downloads. A fila continua em execução, com pendências e falhas anteriores preservadas. Isso não equivale a uma cópia completa do acervo remoto.

## Interface e reprodução

Inspeção do navegador real: monitoramento, Pontos, filtros por união e pesquisa, cartões/lista, preservação ao navegar, relatórios, catálogo, editor de subplaylists e prévia de frios. A navegação agora atualiza o endereço e conserva a página ao recarregar. Nenhum formulário real de preços foi modificado para testar.

Na cópia isolada, o formulário de produto foi exercitado com preço negativo, mensagem inline, borda e `aria-invalid`; correção, perda de foco, salvamento e reabertura confirmaram remoção do erro e persistência do nome comercial. Abrir o formulário após uma prévia herdava a classe escura do diálogo; os três diálogos do catálogo agora restauram sua apresentação padrão. O fluxo foi exercitado e recapturado depois da correção. A revisão também corrigiu ações cortadas na largura de 390 pixels e manteve o menu acessível, sem rolagem horizontal na página.

O player isolado carregou os seis templates e confirmou cache de 12 arquivos. Em 1280×720, foram inspecionados frios (15 produtos, nove à esquerda e seis à direita, destaque R$ 37,50 / 100G), grade com seis fotos e composição de supermercado. O servidor isolado foi desligado: a reprodução continuou com “Sem conexão · programação salva” e eventos pendentes. Ao restaurá-lo, o player voltou a “Offline pronto” e reenviou os eventos. O banco isolado registrou 427 segmentos distintos no ponto de conferência, sem duplicatas; a suíte verifica também reenvio do mesmo identificador.

## Evidência visual e limites

A skill `ui-taste` foi obtida pelo comando solicitado, com leitura completa da saída e arquivos de apoio resolvidos no diretório indicado. A revisão manteve o sistema visual existente; não foi uma reformulação de identidade.

O [recibo visual](../verification/visual-evidence.json) guarda fontes, estilos, imagens, capturas, hashes e estados exercitados. As capturas ficam em `verification/screenshots/`. O verificador da skill examinou 58 arquivos sem apontar arquivos ausentes ou hashes alterados. Seu [resultado](../verification/visual-evidence-check.json) não aprova o conjunto porque mantém explicitamente o bloqueio Full HD abaixo; ele confere integridade e cobertura declarada, não qualidade estética.

**A inspeção visual Full HD continua limitada:** o navegador informou geometria de 1920×1080, mas sua ferramenta de captura retornou o player cortado nas bordas. A captura foi mantida como evidência bloqueada, sem afirmar aprovação em Full HD. As capturas de player em 1280×720 foram obtidas e inspecionadas integralmente. O recibo não recebe aprovação visual completa enquanto essa evidência estiver bloqueada.

Não houve teste em TV física. Memória, Wi-Fi e captura do sistema permanecem explicitamente indisponíveis no player web. Duração histórica permanece desconhecida até existir medição; não foi estimada a partir das contagens antigas. A análise REA é estática e parcial; Ghidra não foi instalado nem usado.
