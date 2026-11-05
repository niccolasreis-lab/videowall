# Cartazes

O editor de cartaz foi ampliado em 30/10/2026 a partir da análise da tela **Novo Cartaz** do VideoWall Musardos v3.9.7. A referência está registrada em [ANALISE_CARTAZ_MUSARDOS.md](ANALISE_CARTAZ_MUSARDOS.md); esta página descreve somente o que foi implementado e verificado no projeto próprio.

## Produtos e ciclo

- O cartaz aceita de zero a seis produtos. Cada linha tem nome, código, unidade, preço e chave **Ativo**.
- **Selecionar produto do catálogo** pesquisa o catálogo central por nome ou código e preenche a linha com os dados do produto disponível. Produtos ausentes ou com preço zero não podem ser selecionados.
- **Importar produtos de CSV** substitui a lista após validar o arquivo inteiro; uma carga inválida não altera as linhas atuais.
- **Tempo por produto** é o intervalo de troca dos layouts que alternam itens. O resumo abaixo dos campos mostra quantos produtos ativos participam e a duração de um ciclo completo:
  - **Lista e destaque**, **Destaque único** e **Campanha** alternam produtos; o ciclo é `produtos ativos × tempo por produto`.
  - **Grade de produtos** mostra todos os itens ao mesmo tempo e não possui rotação por produto; o resumo informa isso explicitamente.
- A duração do item na playlist é independente desse ciclo. A playlist define quanto tempo o cartaz inteiro fica no ar; o ciclo define apenas a troca interna dos produtos.

## Layouts

| Layout | Comportamento implementado |
| --- | --- |
| Campanha | Um produto por vez, centralizado, alternando a cada tempo por produto. |
| Destaque único | Um produto por vez, com tipografia de destaque. |
| Lista e destaque | Todos os produtos visíveis em lista; um item recebe destaque e a marcação avança a cada tempo por produto. |
| Grade de produtos | Todos os produtos visíveis em grade, sem alternância automática. |

Os quatro layouts usam o mesmo renderizador do player e da prévia. A prévia da biblioteca mostra uma composição estática; a prévia ao vivo dentro do editor reproduz a alternância.

## Aparência

| Controle | Efeito | Padrão |
| --- | --- | --- |
| Mostrar unidade | Exibe ` / unidade` ao lado do preço quando a linha tem unidade. | Ligado |
| Cantos arredondados | Arredonda as caixas/linhas de produto. | Desligado |
| Fundo degradê | Aplica uma sobreposição escura neutra sobre a cor de fundo. | Desligado |
| Altura total (ocultar cabeçalho) | Omite o título e a identificação do tipo na tela. O nome da biblioteca continua no painel. | Desligado |
| Fonte do item | Tamanho em pixels do nome do produto. | Automático |
| Fonte do preço | Tamanho em pixels do preço. | Automático |
| Fonte do item em destaque | Tamanho do nome no item destacado. | Automático |
| Fonte do preço em destaque | Tamanho do preço no item destacado. | Automático |

Os tamanhos aceitam inteiros de 8 a 200 pixels. Valores vazios mantêm o tamanho calculado pelo layout. O servidor valida os quatro campos, as opções booleanas e a combinação de título vazio com cabeçalho oculto.

O **tempo por produto** segue o mesmo contrato do servidor: inteiro de 1 a 3600 segundos. Qualquer outro valor (fracionário, zero, negativo ou acima de 3600) cai no padrão de 10 segundos, tanto no resumo do ciclo quanto na rotação renderizada.

## Prévia ao vivo

Ao editar um cartaz, o formulário carrega uma prévia em um quadro 16:9. Ela usa a mesma página de prévia e o mesmo módulo de renderização do player, em um palco de 1920×1080 reduzido para caber no modal. Alterações de texto, produtos, layout, orientação, cores, fontes, tamanhos e opções de aparência atualizam a prévia após uma pequena espera.

Evidência de verificação manual: `../../analise-videowall/cartaz-previa-ao-vivo.jpg` (editor aberto, ciclo calculado em 20s e destaque alternando entre os dois produtos entre capturas; console sem erros).

A prévia foi verificada também contra o servidor real em `http://127.0.0.1:3210`: a página `/preview?embed=1` responde com controles e rodapé ocultos, e um cartaz sintético injetado via `postMessage` renderizou todas as opções de aparência (classes `rounded`, `gradient` e `hide-header`, variáveis de fonte e unidade oculta), com o destaque alternando entre os dois produtos. Nesta verificação o painel administrativo exigia login e não houve alteração de dados reais.

A prévia é manual e isolada:

- não publica a playlist;
- não cria nem altera vínculo de player;
- não registra eventos de exibição;
- não aplica agenda, validade ou bloqueio de preços offline;
- não prova que uma origem externa permite incorporação.

## Temas reutilizáveis

Em **Conteúdos → Criar conteúdo → Cartaz**, o grupo **Temas do cartaz** permite aplicar uma aparência, salvar a aparência atual com um nome e definir ou remover o padrão de novos cartazes. Há quatro paletas próprias: Mercado, Hortifruti, Padaria e Açougue. Podem ser guardados até 100 temas personalizados no banco local, compartilhados pelo painel.

O tema contém apenas cores de fundo/texto, fonte, tamanhos, unidade, cantos, degradê e cabeçalho. Não copia produtos, preços, título, mensagem, layout, orientação, duração ou validade. Aplicar um tema atualiza a prévia; é necessário **Salvar conteúdo** e publicar a playlist para mudar as telas no fluxo normal. O padrão nunca é reaplicado ao editar um cartaz existente. Se o usuário já começou a modificar o formulário, uma resposta tardia da consulta de temas não aplica o padrão sobre as alterações.

Excluir um tema personalizado não modifica cartazes já salvos. Se era o padrão, o padrão é removido. Temas de fábrica não podem ser excluídos. As rotas `/api/poster-themes` exigem a sessão administrativa. Os testes cobrem persistência após reinício, validação, autenticação e preservação de publicações.

## Limites atuais

Ainda não foram implementados, apesar de constarem na referência:

- paleta por componente (fundo de destaque, caixa de preço, tags, linhas pares/ímpares);
- imagem de fundo e rotação de 90/180/270 graus;
- seleção de playlists dentro do formulário do cartaz;
- exportação para vídeo ou imagens em HD/Full HD;
- preenchimento automático de ofertas por ERP.

Esses itens exigem decisões de modelo, validação e cache offline que não foram comprovadas apenas pela existência dos controles na referência. A presença de um controle na tela original não foi tratada como prova de funcionamento.
