# Templates de produtos com fotos

Em **Conteúdos → Tabela de preços → Criar conteúdo**, escolha um dos seis modelos. Novas tabelas começam em **Supermercado**; peças existentes mantêm **Cores personalizadas** ou **Supermercado clássico** até o operador escolher outro modelo.

| Modelo | Produtos por página | Composição |
| --- | --- | --- |
| Supermercado | 5 | Grafite, amarelo e foto lateral |
| Hortifruti — lista | 5 | Verde, amarelo e foto lateral |
| Açougue | 5 | Vinho, branco e foto lateral |
| Padaria | 5 | Creme, marrom e foto lateral |
| Frios — lista e promoção | 18 | Duas colunas de nove, preenchidas de cima para baixo, com pontilhado e promoção inferior |
| Hortifruti — grade | 6 | Três colunas e duas linhas, com foto individual, preço e unidade |

As peças têm até 50 produtos. Só os modelos novos ocultam preços zero e linhas indisponíveis, mantendo a ativação manual. Uma nova carga com preço positivo torna a linha elegível novamente depois de aplicar o catálogo aos rascunhos e publicar. Os estilos anteriores conservam suas regras.

## Fotos, fundos e promoção

- **Foto do setor** troca a composição temática pela imagem escolhida na biblioteca. A opção inicial acompanha o setor do template.
- **Foto do produto** fica na linha do produto e pode ser usada na grade e no destaque. A escolha permanece ao mudar o template. Não há associação automática pelo nome ou marca.
- Em **Frios**, marque **Destaque** em uma única linha. O destaque lê nome, preço, unidade e foto dessa mesma linha, permanece durante a paginação e desaparece se o produto ficar inativo, indisponível ou sem preço positivo.
- Unidades são informadas por produto. `100G`, `KG` e `UN` são exibidos como cadastrados, sem cálculo ou conversão de valores.
- **Formato do preço → Produto = valor / unidade** apresenta, por exemplo, `QUEIJO = R$ 38,90 / KG`, com preço e unidade na mesma linha. Escolha `KG`, `UN` ou `100G` no campo Unidade do produto; campos vazios continuam sem unidade. A opção funciona nos seis templates e nos estilos anteriores, incluindo o destaque de frios, e permanece ao trocar de template. O formato inicial continua **Nome e preço separados**. Salvar altera o rascunho; publicar aplica às TVs.
- **Fundo adicional** e **Fundos do arquivo** oferecem 110 fundos únicos importados de `FundosMidiaIndoor.zip`, fornecido pelo usuário. Os arquivos de origem continuam intactos; as cópias locais têm no máximo 1920×1080 e usam painéis de contraste para os textos. Fotografias podem receber corte para preencher o palco horizontal, mantendo a proporção.
- **Sem fundo adicional** restaura o visual do modelo. Fundos e fotos escolhidos são preservados ao trocar modelos, inclusive quando o estilo selecionado não os utiliza visualmente.

As 12 fotos geradas estão em `public/template-assets/`: cinco setores, seis frutas e um rosbife demonstrativo. Os prompts e a ferramenta usada estão em [TEMPLATE_IMAGE_PROMPTS.json](TEMPLATE_IMAGE_PROMPTS.json). As miniaturas usam dados demonstrativos; esses valores e fotos não são cadastrados automaticamente como produtos reais.

## Prévia e publicação

A prévia ao vivo usa o renderizador do player num palco 1920×1080 reduzido. Ela alterna páginas a cada cinco segundos, sem publicar, gravar eventos ou aplicar agenda e validade. A playlist continua definindo a duração real: o tempo do item é dividido entre suas páginas.

Salvar uma peça comum atualiza o rascunho; publique a playlist para enviá-la às TVs. **Tabela Online** continua permitindo salvar e atualizar a publicação, preservando outras alterações pendentes do rascunho.

As publicações levam as referências de fotos. O player baixa as imagens e o fundo selecionados antes de ativar uma nova versão, conservando a anterior quando um arquivo falha. Arquivos da biblioteca usados em uma peça ou publicação atual têm proteção contra exclusão; um player só acessa fotos associadas à programação do seu ponto. O limite de 24 horas para preços sem confirmação continua valendo.

## Verificação e preparação dos arquivos

`tests/table-templates.test.mjs` cobre os seis modelos, paginação, imagens, publicação, autorização, exclusão protegida, recuperação de disponibilidade e download incompleto. O exemplo de frios tem 18 registros, três preços zero ocultos e o rosbife destacado por 100G.

`scripts/prepare-template-assets.ps1` prepara fotografias e fundos locais, remove duplicatas pelo SHA-256 do arquivo de origem e gera o manifesto `public/template-backgrounds.js`. Não abre documentos nem executa conteúdos do ZIP. Para repetir a preparação, forneça o caminho do arquivo pelo parâmetro `-ArchivePath`; as fontes locais das fotos geradas podem ser indicadas em um JSON pelo parâmetro `-GeneratedSources`.

`scripts/verify-table-templates.mjs` serve somente para um servidor isolado com banco em `verification/test-data`: prepara seis conteúdos, uma playlist e um ponto para inspeção no navegador. A porta padrão é 43219; não execute esse script contra a operação real.
