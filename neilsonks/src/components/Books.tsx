import { Fragment } from 'react'
import content from '../content.json'
import { StandalonePage } from './StandalonePage'
import './books.css'

type Book = typeof content.shelves[number]['books'][number]
function BookEntry({ book }: { book: Book }) {
  return <article className={`book ${book.featured ? 'book-featured' : ''}`} tabIndex={0}>
    <img src={book.image} alt={`${book.title} book cover`} loading="lazy" decoding="async" />
    <h3>{book.title}</h3>
    <p className="book-author">{book.author}</p>
    {book.description && <p className="book-description" dangerouslySetInnerHTML={{ __html: book.description }} />}
    {book.quotes.map((quote, index) => <blockquote key={index} className="book-quote" dangerouslySetInnerHTML={{ __html: quote }} />)}
  </article>
}

export function Books() {
  return <StandalonePage className="reading-page">
    <h1 className="sr-only">Books</h1>
    {content.shelves.map(shelf => <Fragment key={shelf.year}>
      <div className="reading-year"><h2>{shelf.year}</h2></div>
      {[true, false].map(featured => <div key={String(featured)} className={`book-group ${featured ? 'book-gallery' : 'book-shelf'}`}>
        {shelf.books.filter(book => book.featured === featured).map((book, index) => <BookEntry key={index} book={book} />)}
      </div>)}
    </Fragment>)}
  </StandalonePage>
}
